import type {
  AiProvider,
  FactExtraction,
} from "@/ai/provider";
import type {
  EvidenceCoverageItem,
  IndicatorAssessment,
  SafetyFlag,
} from "@/domain/assessment";

export interface MockAiProviderResponses {
  safetyFlags?: SafetyFlag[];
  factExtraction?: FactExtraction;
  indicatorAssessments?: IndicatorAssessment[];
  evidenceCoverage?: EvidenceCoverageItem[];
}

export class MockAiProvider implements AiProvider {
  constructor(private readonly responses: MockAiProviderResponses = {}) {}

  async detectSafety(): Promise<SafetyFlag[]> {
    return structuredClone(this.responses.safetyFlags ?? []);
  }

  async extractFacts(): Promise<FactExtraction> {
    return structuredClone(
      this.responses.factExtraction ?? {
        facts: [],
        timeline: [],
        jurisdictionPatch: {},
      },
    );
  }

  async mapIndicators(): Promise<IndicatorAssessment[]> {
    return structuredClone(this.responses.indicatorAssessments ?? []);
  }

  async summarizeCoverage(): Promise<EvidenceCoverageItem[]> {
    return structuredClone(this.responses.evidenceCoverage ?? []);
  }
}
