import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createConversationOrchestrator } from "@/ai/orchestrator";
import type {
  AiProvider,
  ConversationContext,
  FactExtraction,
  ModelInputPolicy,
} from "@/ai/provider";
import type {
  EvidenceCoverageItem,
  IndicatorAssessment,
  SafetyFlag,
} from "@/domain/assessment";
import { makeConversationContext, makeFactExtraction, makeOrdinarySession } from "../fixtures/ai/session";

const goldenCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  category: z.enum([
    "ordinary",
    "pilot_locale",
    "mixed_language",
    "information_insufficient",
    "prompt_injection",
    "crisis",
  ]),
  locale: z.string().min(2).max(35),
  input: z.string().min(1).max(10_000),
  expected: z.strictObject({
    state: z.enum(["ILO_MAPPING", "SAFETY_ESCALATION"]),
    localSafetyPreemptsProvider: z.boolean(),
  }),
});

type GoldenCase = z.infer<typeof goldenCaseSchema>;

class RecordingFixtureProvider implements AiProvider {
  calls = 0;

  async detectSafety(): Promise<SafetyFlag[]> {
    this.calls += 1;
    return [];
  }

  async extractFacts(): Promise<FactExtraction> {
    this.calls += 1;
    return makeFactExtraction();
  }

  async mapIndicators(): Promise<IndicatorAssessment[]> {
    this.calls += 1;
    return [];
  }

  async summarizeCoverage(): Promise<EvidenceCoverageItem[]> {
    this.calls += 1;
    return [];
  }
}

class RecordingFixturePolicy implements ModelInputPolicy {
  inputs: string[] = [];

  async prepare(input: string) {
    this.inputs.push(input);
    return { kind: "approved" as const, text: input, basis: "no_hint" as const };
  }
}

async function loadGoldenCases(): Promise<GoldenCase[]> {
  const directory = join(process.cwd(), "tests", "fixtures", "golden-cases");
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".json")).sort();
  return Promise.all(
    filenames.map(async (filename) =>
      goldenCaseSchema.parse(JSON.parse(await readFile(join(directory, filename), "utf8"))),
    ),
  );
}

const goldenCases = await loadGoldenCases();

describe("golden AI-native intake cases", () => {
  it("covers every release-required language and adversarial category", () => {
    expect(goldenCases.map((fixture) => fixture.category)).toEqual(expect.arrayContaining([
      "ordinary",
      "pilot_locale",
      "mixed_language",
      "information_insufficient",
      "prompt_injection",
      "crisis",
    ]));
    expect(goldenCases.map((fixture) => fixture.locale)).toEqual(expect.arrayContaining([
      "zh-CN",
      "en",
      "vi",
    ]));
  });

  it.each(goldenCases)("handles $id without an unsafe result claim", async (fixture) => {
    const provider = new RecordingFixtureProvider();
    const policy = new RecordingFixturePolicy();
    const context: ConversationContext = makeConversationContext();
    const turn = await createConversationOrchestrator({ provider, inputPolicy: policy }).handleMessage(
      fixture.input,
      { ...makeOrdinarySession(), context },
    );

    expect(turn.state).toBe(fixture.expected.state);
    expect(turn.message).not.toMatch(
      /(?:构成强迫劳动|已经违法|举报成功率|this is forced labou?r|this is illegal)/iu,
    );

    if (fixture.expected.localSafetyPreemptsProvider) {
      expect(policy.inputs).toEqual([]);
      expect(provider.calls).toBe(0);
    } else {
      expect(policy.inputs).toEqual([fixture.input]);
      expect(provider.calls).toBeGreaterThan(0);
    }
  });
});
