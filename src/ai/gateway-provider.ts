import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  validateEvidenceCoverage,
  validateFactExtraction,
  validateIndicatorAssessments,
  validateSafetyFlags,
} from "@/ai/output-contract";
import {
  ModelInputConfirmationRequired,
  type AiProvider,
  type ConversationContext,
  type FactExtraction,
  type GatewayOperation,
  type GatewayTurnRequest,
  type ModelInputPolicy,
} from "@/ai/provider";
import type {
  EvidenceCoverageItem,
  IndicatorAssessment,
  SafetyFlag,
} from "@/domain/assessment";

export { ModelInputConfirmationRequired } from "@/ai/provider";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const gatewayResponseSchema = z.strictObject({
  requestId: z.string().min(1),
  output: z.unknown(),
});

export interface GatewayAiProviderOptions {
  baseUrl: string;
  token: string;
  modelAlias: string;
  region: string;
  retentionPolicyId: string;
  locale: string;
  inputPolicy: ModelInputPolicy;
  knowledgeSourceIds?: readonly string[];
  fetchImpl?: typeof fetch;
  requestId?: () => string;
  timeoutMs?: number;
}

function parseGatewayBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("AI gateway must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("AI gateway URL must not contain credentials");
  }
  return url;
}

function emptyContext(): ConversationContext {
  return {
    jurisdiction: {},
    facts: [],
    timeline: [],
    sourceMessageIds: [],
  };
}

async function readResponseWithLimit(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error("AI gateway response exceeded the 256 KiB limit");
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
    if (bytesRead > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("AI gateway response exceeded the 256 KiB limit");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export class GatewayAiProvider implements AiProvider {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly requestId: () => string;
  private readonly timeoutMs: number;
  private readonly knowledgeSourceIds: readonly string[];

  constructor(private readonly options: GatewayAiProviderOptions) {
    const baseUrl = parseGatewayBaseUrl(options.baseUrl);
    this.endpoint = new URL("/v1/structured-turn", baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestId = options.requestId ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.knowledgeSourceIds = options.knowledgeSourceIds ?? [];

    if (this.timeoutMs <= 0 || this.timeoutMs > DEFAULT_TIMEOUT_MS) {
      throw new Error("AI gateway timeout must be between 1 and 15000 milliseconds");
    }
  }

  async detectSafety(input: string): Promise<SafetyFlag[]> {
    const context = emptyContext();
    const output = await this.requestStructuredTurn("detect_safety", input, context);
    return validateSafetyFlags(output);
  }

  async extractFacts(
    input: string,
    context: ConversationContext,
  ): Promise<FactExtraction> {
    const output = await this.requestStructuredTurn("extract_facts", input, context);
    return validateFactExtraction(output, {
      conversationMessageIds: context.sourceMessageIds,
      knowledgeSourceIds: this.knowledgeSourceIds,
    });
  }

  async mapIndicators(
    input: string,
    context: ConversationContext,
  ): Promise<IndicatorAssessment[]> {
    const output = await this.requestStructuredTurn("map_indicators", input, context);
    return validateIndicatorAssessments(output, {
      conversationMessageIds: context.sourceMessageIds,
      knowledgeSourceIds: this.knowledgeSourceIds,
    });
  }

  async summarizeCoverage(
    input: string,
    context: ConversationContext,
  ): Promise<EvidenceCoverageItem[]> {
    const output = await this.requestStructuredTurn("summarize_coverage", input, context);
    return validateEvidenceCoverage(output, {
      conversationMessageIds: context.sourceMessageIds,
      knowledgeSourceIds: this.knowledgeSourceIds,
    });
  }

  private async requestStructuredTurn(
    operation: GatewayOperation,
    input: string,
    context: ConversationContext,
  ): Promise<unknown> {
    const decision = await this.options.inputPolicy.prepare(input);
    if (decision.kind === "confirmation_required") {
      throw new ModelInputConfirmationRequired(decision.hintIds);
    }

    const requestId = this.requestId();
    const envelope: GatewayTurnRequest = {
      requestId,
      operation,
      schemaVersion: "1.0",
      locale: this.options.locale,
      input: decision.text,
      context,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "x-model-alias": this.options.modelAlias,
          "x-data-region": this.options.region,
          "x-retention-policy-id": this.options.retentionPolicyId,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI gateway returned HTTP ${response.status}`);
      }

      const responseText = await readResponseWithLimit(response);
      let rawResponse: unknown;
      try {
        rawResponse = JSON.parse(responseText);
      } catch {
        throw new Error("AI gateway returned invalid JSON");
      }

      if (
        !rawResponse ||
        typeof rawResponse !== "object" ||
        !Object.hasOwn(rawResponse, "output")
      ) {
        throw new Error("AI gateway response is missing output");
      }

      const parsed = gatewayResponseSchema.parse(rawResponse);
      if (parsed.requestId !== requestId) {
        throw new Error("AI gateway response requestId mismatch");
      }
      return parsed.output;
    } finally {
      clearTimeout(timeout);
    }
  }
}
