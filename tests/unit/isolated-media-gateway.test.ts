import { describe, expect, it, vi } from "vitest";

import {
  createIsolatedMediaGatewayFromEnv,
  IsolatedMediaGatewayParser,
  IsolatedMediaGatewayScanner,
} from "@/media/security/isolated-media-gateway";
import type { FileSignatureResult } from "@/media/security/file-signature";

const baseOptions = {
  baseUrl: "https://media-gateway.example.test",
  token: "media-gateway-token-value",
  retentionPolicyId: "reviewed:no-training",
  requestId: () => "request-fixed-001",
};

const pdfSignature: FileSignatureResult = {
  declaredMime: "application/pdf",
  detectedMime: "application/pdf",
  signatureStatus: "match",
  dangerous: false,
  container: "pdf",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("isolated media gateway adapters", () => {
  it("sends scanner bytes over HTTPS without forwarding the original filename", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      requestId: "request-fixed-001",
      verdict: "clean",
    }));
    const scanner = new IsolatedMediaGatewayScanner({ ...baseOptions, fetchImpl });

    await expect(scanner.scan({ bytes: Buffer.from("fixture"), filename: "worker-passport.pdf" })).resolves.toEqual({
      verdict: "clean",
    });
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://media-gateway.example.test/v1/media/scan");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      authorization: "Bearer media-gateway-token-value",
      "content-type": "application/octet-stream",
      "x-media-operation": "scan",
      "x-retention-policy-id": "reviewed:no-training",
      "x-request-id": "request-fixed-001",
    });
    expect(Buffer.from(request.body as Uint8Array)).toEqual(Buffer.from("fixture"));
    expect(JSON.stringify(request.headers)).not.toContain("worker-passport.pdf");
  });

  it("rejects scanner response tampering and does not expose the gateway token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      requestId: "request-attacker",
      verdict: "clean",
      unexpected: "field",
    }));
    const scanner = new IsolatedMediaGatewayScanner({ ...baseOptions, fetchImpl });

    await expect(scanner.scan({ bytes: Buffer.from("fixture"), filename: "anything.pdf" })).rejects.toThrow(
      "MEDIA_GATEWAY_RESPONSE_INVALID",
    );
    await expect(scanner.scan({ bytes: Buffer.from("fixture"), filename: "anything.pdf" })).rejects.not.toThrow(
      "media-gateway-token-value",
    );
  });

  it("parses only a strict derivative and sends signature metadata instead of a filename", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      requestId: "request-fixed-001",
      derivative: {
        contentRef: "derived/pdf-001",
        text: "safe extracted text",
        sourceSpans: [{ start: 0, end: 4 }],
      },
    }));
    const parser = new IsolatedMediaGatewayParser({ ...baseOptions, fetchImpl });

    expect(parser.supports(pdfSignature)).toBe(true);
    await expect(parser.parse({ bytes: Buffer.from("%PDF-1.7"), signature: pdfSignature })).resolves.toEqual({
      contentRef: "derived/pdf-001",
      text: "safe extracted text",
      sourceSpans: [{ start: 0, end: 4 }],
    });
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://media-gateway.example.test/v1/media/parse");
    expect(request.headers).toMatchObject({
      "x-media-operation": "parse",
      "x-detected-mime": "application/pdf",
      "x-media-container": "pdf",
    });
  });

  it("rejects an invalid derivative and an oversized response", async () => {
    const invalidFetch = vi.fn(async () => jsonResponse({
      requestId: "request-fixed-001",
      derivative: { contentRef: "../outside", text: "unsafe" },
    }));
    const parser = new IsolatedMediaGatewayParser({ ...baseOptions, fetchImpl: invalidFetch });
    await expect(parser.parse({ bytes: Buffer.from("%PDF-1.7"), signature: pdfSignature })).rejects.toThrow(
      "MEDIA_GATEWAY_RESPONSE_INVALID",
    );

    const oversizedFetch = vi.fn(async () => new Response("x".repeat(2_100_000), {
      status: 200,
      headers: { "content-length": "2100000" },
    }));
    const scanner = new IsolatedMediaGatewayScanner({ ...baseOptions, fetchImpl: oversizedFetch });
    await expect(scanner.scan({ bytes: Buffer.from("fixture"), filename: "anything.pdf" })).rejects.toThrow(
      "MEDIA_GATEWAY_RESPONSE_TOO_LARGE",
    );
  });

  it("fails closed on invalid configuration and accepts a reviewed HTTPS configuration", () => {
    expect(createIsolatedMediaGatewayFromEnv({
      MATERIAL_SECURITY_GATEWAY: "isolated",
      MATERIAL_SECURITY_GATEWAY_URL: "http://media-gateway.example.test",
      MATERIAL_SECURITY_GATEWAY_TOKEN: "short",
      MATERIAL_SECURITY_RETENTION_POLICY_ID: "unreviewed",
    })).toMatchObject({ available: false, reason: "invalid_configuration" });

    const configuration = createIsolatedMediaGatewayFromEnv({
      MATERIAL_SECURITY_GATEWAY: "isolated",
      MATERIAL_SECURITY_GATEWAY_URL: "https://media-gateway.example.test",
      MATERIAL_SECURITY_GATEWAY_TOKEN: "media-gateway-token-value",
      MATERIAL_SECURITY_RETENTION_POLICY_ID: "reviewed:no-training",
    });
    expect(configuration.available).toBe(true);
    if (configuration.available) {
      expect(configuration.scanner).toBeInstanceOf(IsolatedMediaGatewayScanner);
      expect(configuration.parser).toBeInstanceOf(IsolatedMediaGatewayParser);
    }
  });

  it("rejects non-HTTPS gateway URLs before creating an adapter", () => {
    expect(() => new IsolatedMediaGatewayScanner({ ...baseOptions, baseUrl: "http://media-gateway.example.test" })).toThrow(
      "MEDIA_GATEWAY_HTTPS_REQUIRED",
    );
  });
});
