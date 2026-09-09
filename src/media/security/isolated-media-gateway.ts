import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  parsedMaterialDerivativeSchema,
  ParserRegistry,
  type MaterialParser,
  type ParsedMaterialDerivative,
} from "@/media/parsers/parser-registry";
import type { FileSignatureResult } from "@/media/security/file-signature";
import type { MalwareScanResult, MalwareScanner } from "@/media/security/malware-scanner";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ALLOWED_RESPONSE_BYTES = 16 * 1024 * 1024;

const reviewedRetentionPolicyPattern = /^reviewed:[A-Za-z0-9._-]{1,128}$/u;

const scannerResponseSchema = z.discriminatedUnion("verdict", [
  z.strictObject({
    requestId: z.string().min(1),
    verdict: z.literal("clean"),
  }),
  z.strictObject({
    requestId: z.string().min(1),
    verdict: z.literal("malicious"),
    reason: z.string().optional(),
  }),
  z.strictObject({
    requestId: z.string().min(1),
    verdict: z.literal("error"),
    reason: z.string().min(1),
  }),
]);

const parserResponseSchema = z.strictObject({
  requestId: z.string().min(1),
  derivative: parsedMaterialDerivativeSchema,
});

export interface IsolatedMediaGatewayOptions {
  baseUrl: string;
  token: string;
  retentionPolicyId: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  requestId?: () => string;
}

export type IsolatedMediaGatewayConfiguration =
  | {
      available: true;
      scanner: IsolatedMediaGatewayScanner;
      parser: IsolatedMediaGatewayParser;
      parsers: ParserRegistry;
    }
  | {
      available: false;
      reason: "not_configured" | "invalid_configuration";
    };

interface IsolatedMediaGatewayFactoryOptions {
  fetchImpl?: typeof fetch;
  requestId?: () => string;
}

function parseGatewayBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MEDIA_GATEWAY_URL_INVALID");
  }
  if (url.protocol !== "https:") {
    throw new Error("MEDIA_GATEWAY_HTTPS_REQUIRED");
  }
  if (url.username || url.password) {
    throw new Error("MEDIA_GATEWAY_URL_CREDENTIALS_FORBIDDEN");
  }
  return url;
}

function validateOptions(options: IsolatedMediaGatewayOptions): void {
  if (
    typeof options.token !== "string" ||
    options.token.trim().length < 16 ||
    options.token !== options.token.trim() ||
    /[\r\n]/u.test(options.token)
  ) {
    throw new Error("MEDIA_GATEWAY_TOKEN_INVALID");
  }
  if (typeof options.retentionPolicyId !== "string" || !reviewedRetentionPolicyPattern.test(options.retentionPolicyId)) {
    throw new Error("MEDIA_GATEWAY_RETENTION_POLICY_INVALID");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error("MEDIA_GATEWAY_TIMEOUT_INVALID");
  }
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > MAX_ALLOWED_RESPONSE_BYTES) {
    throw new Error("MEDIA_GATEWAY_RESPONSE_LIMIT_INVALID");
  }
}

function toBody(bytes: Uint8Array): BodyInit {
  return bytes as unknown as BodyInit;
}

async function readResponseWithLimit(response: Response, maxResponseBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
    }
    if (parsedLength > maxResponseBytes) {
      throw new Error("MEDIA_GATEWAY_RESPONSE_TOO_LARGE");
    }
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxResponseBytes) {
      await reader.cancel();
      throw new Error("MEDIA_GATEWAY_RESPONSE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
  }
}

function validateDerivative(derivative: ParsedMaterialDerivative): ParsedMaterialDerivative {
  if (derivative.sourceSpans?.some((span) => span.start > span.end || span.end > derivative.text.length)) {
    throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
  }
  return derivative;
}

abstract class IsolatedMediaGatewayAdapter {
  protected readonly endpoint: URL;
  protected readonly fetchImpl: typeof fetch;
  protected readonly requestId: () => string;
  protected readonly timeoutMs: number;
  protected readonly maxResponseBytes: number;

  constructor(protected readonly options: IsolatedMediaGatewayOptions, path: string) {
    validateOptions(options);
    this.endpoint = new URL(path, parseGatewayBaseUrl(options.baseUrl));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestId = options.requestId ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  protected async post(input: {
    operation: "scan" | "parse";
    bytes: Uint8Array;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    const requestId = this.requestId();
    if (typeof requestId !== "string" || requestId.trim().length === 0 || requestId.length > 200) {
      throw new Error("MEDIA_GATEWAY_REQUEST_ID_INVALID");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.token}`,
            "content-type": "application/octet-stream",
            "x-media-operation": input.operation,
            "x-request-id": requestId,
            "x-retention-policy-id": this.options.retentionPolicyId,
            ...input.headers,
          },
          body: toBody(input.bytes),
          signal: controller.signal,
        });
      } catch {
        throw new Error(controller.signal.aborted ? "MEDIA_GATEWAY_TIMEOUT" : "MEDIA_GATEWAY_REQUEST_FAILED");
      }

      if (!response.ok) {
        throw new Error("MEDIA_GATEWAY_HTTP_ERROR");
      }
      let raw: unknown;
      try {
        raw = parseJson(await readResponseWithLimit(response, this.maxResponseBytes));
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("MEDIA_GATEWAY_")) throw error;
        throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
      }
      if (!raw || typeof raw !== "object" || !Object.hasOwn(raw, "requestId")) {
        throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
      }
      const responseRequestId = (raw as { requestId?: unknown }).requestId;
      if (responseRequestId !== requestId) {
        throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
      }
      return raw;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class IsolatedMediaGatewayScanner extends IsolatedMediaGatewayAdapter implements MalwareScanner {
  constructor(options: IsolatedMediaGatewayOptions) {
    super(options, "/v1/media/scan");
  }

  async scan(input: { bytes: Uint8Array; filename: string }): Promise<MalwareScanResult> {
    void input.filename;
    const raw = await this.post({ operation: "scan", bytes: input.bytes });
    const parsed = scannerResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
    }
    if (parsed.data.verdict === "clean") return { verdict: "clean" };
    if (parsed.data.verdict === "error") return { verdict: "error", reason: parsed.data.reason };
    return parsed.data.reason === undefined
      ? { verdict: "malicious" }
      : { verdict: "malicious", reason: parsed.data.reason };
  }
}

export class IsolatedMediaGatewayParser extends IsolatedMediaGatewayAdapter implements MaterialParser {
  readonly id = "isolated-media-gateway";

  constructor(options: IsolatedMediaGatewayOptions) {
    super(options, "/v1/media/parse");
  }

  supports(signature: FileSignatureResult): boolean {
    return !signature.dangerous && signature.detectedMime !== null;
  }

  async parse(input: { bytes: Uint8Array; signature: FileSignatureResult }): Promise<ParsedMaterialDerivative> {
    if (!this.supports(input.signature)) {
      throw new Error("MEDIA_GATEWAY_MEDIA_UNSUPPORTED");
    }
    const detectedMime = input.signature.detectedMime;
    if (detectedMime === null) {
      throw new Error("MEDIA_GATEWAY_MEDIA_UNSUPPORTED");
    }
    const raw = await this.post({
      operation: "parse",
      bytes: input.bytes,
      headers: {
        "x-detected-mime": detectedMime,
        "x-media-container": input.signature.container,
      },
    });
    const parsed = parserResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("MEDIA_GATEWAY_RESPONSE_INVALID");
    }
    return validateDerivative(parsed.data.derivative);
  }
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function createIsolatedMediaGatewayFromEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: IsolatedMediaGatewayFactoryOptions = {},
): IsolatedMediaGatewayConfiguration {
  if (input.MATERIAL_SECURITY_GATEWAY?.trim() !== "isolated") {
    return { available: false, reason: "not_configured" };
  }

  const baseUrl = input.MATERIAL_SECURITY_GATEWAY_URL?.trim();
  const token = input.MATERIAL_SECURITY_GATEWAY_TOKEN;
  const retentionPolicyId = input.MATERIAL_SECURITY_RETENTION_POLICY_ID?.trim();
  const timeoutMs = parseOptionalInteger(input.MATERIAL_SECURITY_GATEWAY_TIMEOUT_MS);
  const maxResponseBytes = parseOptionalInteger(input.MATERIAL_SECURITY_GATEWAY_MAX_RESPONSE_BYTES);

  if (!baseUrl || !token || !retentionPolicyId || Number.isNaN(timeoutMs) || Number.isNaN(maxResponseBytes)) {
    return { available: false, reason: "invalid_configuration" };
  }

  try {
    const adapterOptions: IsolatedMediaGatewayOptions = {
      baseUrl,
      token,
      retentionPolicyId,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.requestId ? { requestId: options.requestId } : {}),
    };
    const scanner = new IsolatedMediaGatewayScanner(adapterOptions);
    const parser = new IsolatedMediaGatewayParser(adapterOptions);
    return { available: true, scanner, parser, parsers: new ParserRegistry([parser]) };
  } catch {
    return { available: false, reason: "invalid_configuration" };
  }
}
