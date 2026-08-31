import { createServer, request as nodeHttpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { GatewayAiProvider, ModelInputConfirmationRequired } from "@/ai/gateway-provider";
import { createConversationOrchestrator } from "@/ai/orchestrator";
import type {
  AiProvider,
  FactExtraction,
  ModelInputPolicy,
} from "@/ai/provider";
import type {
  EvidenceCoverageItem,
  IndicatorAssessment,
  SafetyFlag,
} from "@/domain/assessment";
import crisisFixture from "../fixtures/ai/crisis-message.json";
import ordinaryFixture from "../fixtures/ai/ordinary-message.json";
import {
  makeFactExtraction,
  makeOrdinarySession,
} from "../fixtures/ai/session";

class RecordingProvider implements AiProvider {
  readonly calls: string[] = [];

  constructor(
    private readonly results: {
      safety?: unknown;
      extraction?: unknown;
      indicators?: unknown;
      coverage?: unknown;
      error?: Error;
    } = {},
  ) {}

  async detectSafety(): Promise<SafetyFlag[]> {
    this.calls.push("detect_safety");
    if (this.results.error) throw this.results.error;
    return (this.results.safety ?? []) as SafetyFlag[];
  }

  async extractFacts(): Promise<FactExtraction> {
    this.calls.push("extract_facts");
    if (this.results.error) throw this.results.error;
    return (this.results.extraction ?? makeFactExtraction()) as FactExtraction;
  }

  async mapIndicators(): Promise<IndicatorAssessment[]> {
    this.calls.push("map_indicators");
    if (this.results.error) throw this.results.error;
    return (this.results.indicators ?? []) as IndicatorAssessment[];
  }

  async summarizeCoverage(): Promise<EvidenceCoverageItem[]> {
    this.calls.push("summarize_coverage");
    if (this.results.error) throw this.results.error;
    return (this.results.coverage ?? []) as EvidenceCoverageItem[];
  }
}

class RecordingPolicy implements ModelInputPolicy {
  readonly inputs: string[] = [];

  constructor(
    private readonly decision: Awaited<ReturnType<ModelInputPolicy["prepare"]>> = {
      kind: "approved",
      text: "已脱敏输入",
      basis: "redacted",
    },
  ) {}

  async prepare(input: string) {
    this.inputs.push(input);
    return this.decision;
  }
}

describe("crisis-first conversation orchestration", () => {
  it("switches to safety escalation locally before policy or provider calls", async () => {
    const provider = new RecordingProvider();
    const policy = new RecordingPolicy();
    const orchestrator = createConversationOrchestrator({ provider, inputPolicy: policy });

    const turn = await orchestrator.handleMessage(crisisFixture.input, makeOrdinarySession());

    expect(turn.state).toBe("SAFETY_ESCALATION");
    expect(turn.questions).toHaveLength(0);
    expect(turn.actions).toEqual(
      expect.arrayContaining(["show_emergency_resources", "pause", "exit"]),
    );
    expect(turn.draftPatch).toBeUndefined();
    expect(policy.inputs).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("does not let a PII confirmation gate hide a physical-harm threat", async () => {
    const provider = new RecordingProvider();
    const policy = new RecordingPolicy({
      kind: "confirmation_required",
      hintIds: ["hint-phone-1"],
    });
    const orchestrator = createConversationOrchestrator({ provider, inputPolicy: policy });

    const turn = await orchestrator.handleMessage(
      "他们威胁要杀我，电话是 13800138000",
      makeOrdinarySession(),
    );

    expect(turn.state).toBe("SAFETY_ESCALATION");
    expect(turn.actions).toContain("show_emergency_resources");
    expect(policy.inputs).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("limits an ordinary turn to three questions", async () => {
    const provider = new RecordingProvider();
    const orchestrator = createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
    });

    const turn = await orchestrator.handleMessage(
      ordinaryFixture.input,
      makeOrdinarySession(),
    );

    expect(turn.state).toBe("ILO_MAPPING");
    expect(turn.questions.length).toBeLessThanOrEqual(3);
    expect(turn.draftPatch?.facts).toHaveLength(1);
    expect(provider.calls).toEqual(["detect_safety", "extract_facts"]);
  });

  it("asks for user review without calling a provider when input confirmation is required", async () => {
    const provider = new RecordingProvider();
    const policy = new RecordingPolicy({
      kind: "confirmation_required",
      hintIds: ["hint-phone-1"],
    });
    const orchestrator = createConversationOrchestrator({ provider, inputPolicy: policy });

    const turn = await orchestrator.handleMessage(ordinaryFixture.input, makeOrdinarySession());

    expect(turn.state).toBe("USER_REVIEW");
    expect(turn.actions).toEqual(
      expect.arrayContaining(["show_emergency_resources", "pause"]),
    );
    expect(turn.draftPatch).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
  });

  it("uses a static fallback and preserves the draft on provider failure", async () => {
    const provider = new RecordingProvider({ error: new Error("provider unavailable") });
    const orchestrator = createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
    });

    const turn = await orchestrator.handleMessage(ordinaryFixture.input, makeOrdinarySession());

    expect(turn.degraded).toBe(true);
    expect(turn.draftPatch).toBeUndefined();
    expect(turn.message).not.toMatch(/已保存|已提交/u);
  });

  it("rejects nested assessment scoring fields without mutating the draft", async () => {
    const provider = new RecordingProvider({
      extraction: {
        ...makeFactExtraction(),
        metadata: { score: 0.9 },
      },
    });
    const orchestrator = createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
    });

    const turn = await orchestrator.handleMessage(ordinaryFixture.input, makeOrdinarySession());

    expect(turn.degraded).toBe(true);
    expect(turn.draftPatch).toBeUndefined();
  });

  it.each([
    "这属于强迫劳动",
    "这就是强迫劳动",
    "可认定为强迫劳动",
    "这是违法的",
    "this is forced labor",
    "this amounts to forced labour",
    "this is illegal",
    "this violates the law",
  ])(
    "rejects the model legal conclusion %s",
    async (conclusion) => {
      const unsafeProvider = new RecordingProvider({
        extraction: makeFactExtraction({
          facts: [
            {
              ...makeFactExtraction().facts[0]!,
              value: conclusion,
            },
          ],
        }),
      });
      const orchestrator = createConversationOrchestrator({
        provider: unsafeProvider,
        inputPolicy: new RecordingPolicy(),
      });

      const turn = await orchestrator.handleMessage(ordinaryFixture.input, makeOrdinarySession());

      expect(turn.degraded).toBe(true);
      expect(turn.draftPatch).toBeUndefined();
    },
  );

  it("rejects an unknown conversation source id", async () => {
    const unsafeProvider = new RecordingProvider({
      extraction: makeFactExtraction({
        facts: [
          {
            ...makeFactExtraction().facts[0]!,
            sourceMessageIds: ["msg-invented"],
          },
        ],
      }),
    });
    const orchestrator = createConversationOrchestrator({
      provider: unsafeProvider,
      inputPolicy: new RecordingPolicy(),
    });

    const turn = await orchestrator.handleMessage(ordinaryFixture.input, makeOrdinarySession());

    expect(turn.degraded).toBe(true);
    expect(turn.draftPatch).toBeUndefined();
  });

  it("treats empty indicator and coverage outputs as provider failures", async () => {
    const provider = new RecordingProvider({ indicators: [], coverage: [] });
    const orchestrator = createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
    });

    const indicatorTurn = await orchestrator.handleMessage(ordinaryFixture.input, {
      ...makeOrdinarySession(),
      state: "ILO_MAPPING",
    });
    const coverageTurn = await orchestrator.handleMessage(ordinaryFixture.input, {
      ...makeOrdinarySession(),
      state: "EVIDENCE_COVERAGE",
    });

    expect(indicatorTurn).toMatchObject({ degraded: true });
    expect(indicatorTurn.draftPatch).toBeUndefined();
    expect(coverageTurn).toMatchObject({ degraded: true });
    expect(coverageTurn.draftPatch).toBeUndefined();
  });

  it("rejects unknown knowledge ids while accepting registered knowledge ids", async () => {
    const indicator = {
      indicatorId: 1 as const,
      status: "insufficient" as const,
      basis: [{ kind: "knowledge" as const, id: "kb-ilo-core-definition" }],
      missing: ["需要更多事实"],
    };
    const provider = new RecordingProvider({ indicators: [indicator] });
    const session = { ...makeOrdinarySession(), state: "ILO_MAPPING" as const };

    const accepted = await createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
      knowledgeSourceIds: ["kb-ilo-core-definition"],
    }).handleMessage(ordinaryFixture.input, session);
    const rejected = await createConversationOrchestrator({
      provider,
      inputPolicy: new RecordingPolicy(),
      knowledgeSourceIds: [],
    }).handleMessage(ordinaryFixture.input, session);

    expect(accepted.draftPatch?.iloIndicators).toEqual([indicator]);
    expect(accepted.degraded).toBe(false);
    expect(rejected.degraded).toBe(true);
    expect(rejected.draftPatch).toBeUndefined();
  });

  it("rejects empty and oversized input before any policy or provider call", async () => {
    const provider = new RecordingProvider();
    const policy = new RecordingPolicy();
    const orchestrator = createConversationOrchestrator({ provider, inputPolicy: policy });

    await expect(orchestrator.handleMessage("   ", makeOrdinarySession())).rejects.toThrow(
      /1.*10,?000/u,
    );
    await expect(
      orchestrator.handleMessage("a".repeat(10_001), makeOrdinarySession()),
    ).rejects.toThrow(/1.*10,?000/u);
    expect(policy.inputs).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("provider-neutral gateway", () => {
  const baseConfig = {
    baseUrl: "https://gateway.example.test",
    token: "gateway-token-value",
    modelAlias: "reviewed-model-alias",
    region: "eu-central",
    retentionPolicyId: "reviewed:no-training",
    locale: "zh-CN",
    knowledgeSourceIds: ["kb-ilo-core-definition"],
  } as const;

  it("sends the reviewed headers and strict request envelope once", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const captured = new Request(request, init);
      requests.push(captured);
      const body = (await captured.clone().json()) as { requestId: string };
      return Response.json({ requestId: body.requestId, output: [] });
    });
    const provider = new GatewayAiProvider({
      ...baseConfig,
      inputPolicy: new RecordingPolicy({
        kind: "approved",
        text: "脱敏后的文本",
        basis: "redacted",
      }),
      fetchImpl: fetchImpl as typeof fetch,
      requestId: () => "req-test-001",
    });

    await expect(provider.detectSafety("原始文本 13800138000")).resolves.toEqual([]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = requests[0]!;
    expect(request.url).toBe("https://gateway.example.test/v1/structured-turn");
    expect(request.headers.get("authorization")).toBe("Bearer gateway-token-value");
    expect(request.headers.get("x-model-alias")).toBe("reviewed-model-alias");
    expect(request.headers.get("x-data-region")).toBe("eu-central");
    expect(request.headers.get("x-retention-policy-id")).toBe("reviewed:no-training");
    await expect(request.clone().json()).resolves.toEqual({
      requestId: "req-test-001",
      operation: "detect_safety",
      schemaVersion: "1.0",
      locale: "zh-CN",
      input: "脱敏后的文本",
      context: {
        jurisdiction: {},
        facts: [],
        timeline: [],
        sourceMessageIds: [],
      },
    });
  });

  it("works through a real Node test server with one streamed request", async () => {
    let attempts = 0;
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    let receivedBody: Record<string, unknown> = {};
    const server = createServer((request, response) => {
      attempts += 1;
      receivedHeaders = request.headers;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
          string,
          unknown
        >;
        const responseBody = JSON.stringify({
          requestId: receivedBody.requestId,
          output: [],
        });
        response.writeHead(200, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(responseBody),
        });
        response.end(responseBody);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const fetchImpl: typeof fetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      target.protocol = "http:";
      target.hostname = "127.0.0.1";
      target.port = String(address.port);
      return await new Promise<Response>((resolve, reject) => {
        const request = nodeHttpRequest(
          target,
          {
            method: init?.method,
            headers: Object.fromEntries(new Headers(init?.headers).entries()),
            signal: init?.signal ?? undefined,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              const headers = new Headers();
              for (const [name, value] of Object.entries(response.headers)) {
                if (Array.isArray(value)) {
                  value.forEach((item) => headers.append(name, item));
                } else if (value !== undefined) {
                  headers.set(name, value);
                }
              }
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: response.statusCode ?? 500,
                  headers,
                }),
              );
            });
          },
        );
        request.on("error", reject);
        request.end(typeof init?.body === "string" ? init.body : undefined);
      });
    };

    try {
      const provider = new GatewayAiProvider({
        ...baseConfig,
        inputPolicy: new RecordingPolicy({
          kind: "approved",
          text: "经确认的文本",
          basis: "user_confirmed",
        }),
        fetchImpl,
        requestId: () => "req-node-server-001",
      });

      await expect(provider.detectSafety("原始文本")).resolves.toEqual([]);
      expect(attempts).toBe(1);
      expect(receivedHeaders.authorization).toBe("Bearer gateway-token-value");
      expect(receivedBody).toMatchObject({
        requestId: "req-node-server-001",
        operation: "detect_safety",
        input: "经确认的文本",
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not call the gateway when its own input policy requires confirmation", async () => {
    const fetchImpl = vi.fn();
    const provider = new GatewayAiProvider({
      ...baseConfig,
      inputPolicy: new RecordingPolicy({
        kind: "confirmation_required",
        hintIds: ["hint-identity-1"],
      }),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.detectSafety("敏感原文")).rejects.toBeInstanceOf(
      ModelInputConfirmationRequired,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("rejects responses above 256 KiB without retrying", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(256 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new GatewayAiProvider({
      ...baseConfig,
      inputPolicy: new RecordingPolicy(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.detectSafety("普通文本")).rejects.toThrow(/256 KiB/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts at the configured deadline without retrying", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const provider = new GatewayAiProvider({
      ...baseConfig,
      inputPolicy: new RecordingPolicy(),
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 10,
    });

    await expect(provider.detectSafety("普通文本")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
