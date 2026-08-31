import {
  validateEvidenceCoverage,
  validateFactExtraction,
  validateIndicatorAssessments,
  validateSafetyFlags,
} from "@/ai/output-contract";
import {
  ModelInputConfirmationRequired,
  type AiProvider,
  type AssistantTurn,
  type ConversationContext,
  type ConversationOrchestrator,
  type ConversationSession,
  type ConversationState,
  type ModelInputPolicy,
} from "@/ai/provider";
import type { SafetyFlag } from "@/domain/assessment";
import type { CasePatch } from "@/domain/case-record";

const MAX_INPUT_CHARACTERS = 10_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

const transitionTable: Record<ConversationState, ConversationState> = {
  WELCOME: "SAFETY_CHECK",
  SAFETY_CHECK: "JURISDICTION_CONTEXT",
  JURISDICTION_CONTEXT: "FACT_GATHERING",
  FACT_GATHERING: "ILO_MAPPING",
  ILO_MAPPING: "EVIDENCE_COVERAGE",
  EVIDENCE_COVERAGE: "LEGAL_NAVIGATION",
  LEGAL_NAVIGATION: "CHANNEL_OPTIONS",
  CHANNEL_OPTIONS: "USER_REVIEW",
  USER_REVIEW: "SAVE_OR_EXPORT",
  SAVE_OR_EXPORT: "SAVE_OR_EXPORT",
  SAFETY_ESCALATION: "SAFETY_ESCALATION",
};

const questionsByState: Record<ConversationState, readonly string[]> = {
  WELCOME: [],
  SAFETY_CHECK: ["你现在是否处于可以安全继续交流的环境？"],
  JURISDICTION_CONTEXT: [
    "事情主要发生在哪个国家或地区？",
    "你现在位于哪个国家或地区？",
    "相关产品可能流向哪个国家或地区？",
  ],
  FACT_GATHERING: [
    "你愿意从发生了什么开始讲吗？",
    "这些事情大约发生在什么时间？",
  ],
  ILO_MAPPING: [
    "如果你拒绝这些要求，可能会发生什么？",
    "你是否可以自由离开工作地点或住宿地点？",
    "有没有你能在安全情况下保留的相关材料？",
  ],
  EVIDENCE_COVERAGE: [
    "你希望先核对时间线、工作关系，还是已有材料？",
    "哪些内容是你亲自经历或直接看到的？",
  ],
  LEGAL_NAVIGATION: ["确认法域后，你是否希望查看可能相关的法律信息来源？"],
  CHANNEL_OPTIONS: ["你是否希望查看由你自行决定是否联系的渠道？"],
  USER_REVIEW: ["你希望先修改哪一部分档案？"],
  SAVE_OR_EXPORT: ["你希望继续补充、保存当前版本，还是预览导出内容？"],
  SAFETY_ESCALATION: [],
};

const localSafetyRules: ReadonlyArray<{ flag: SafetyFlag; pattern: RegExp }> = [
  {
    flag: "violence",
    pattern:
      /(打我|殴打|暴力伤害|袭击我|威胁.{0,8}(?:杀|弄死|伤害)我|(?:持刀|拿枪|用枪|用刀)威胁|性侵|强奸|beat(?:ing)? me|physically attacked|threaten(?:ed|ing)? to (?:kill|hurt) me|weapon|sexual(?:ly)? assault)/iu,
  },
  {
    flag: "confinement",
    pattern: /(锁起来|关起来|不让我离开|无法自由离开|locked (?:me )?in|confined|detained)/iu,
  },
  {
    flag: "self_harm",
    pattern: /(自杀|自残|不想活|kill myself|suicid(?:e|al)|self[- ]harm)/iu,
  },
  {
    flag: "minor",
    pattern: /(未成年(?:人)?被迫|童工|child forced to work|forced minor)/iu,
  },
  {
    flag: "trafficking",
    pattern: /(人口贩运|被卖到|traffick(?:ed|ing)|sold me to)/iu,
  },
];

export interface ConversationOrchestratorOptions {
  provider: AiProvider;
  inputPolicy: ModelInputPolicy;
  knowledgeSourceIds?: readonly string[];
  providerTimeoutMs?: number;
}

function findLocalSafetyFlags(input: string): SafetyFlag[] {
  return localSafetyRules
    .filter(({ pattern }) => pattern.test(input))
    .map(({ flag }) => flag);
}

function safetyTurn(): AssistantTurn {
  return {
    state: "SAFETY_ESCALATION",
    message:
      "你的安全比继续整理材料更重要。如果你正面临即时危险，请在安全可行时联系当地紧急服务或可信赖的支持人员；你也可以暂停或退出。",
    questions: [],
    actions: ["show_emergency_resources", "pause", "exit"],
    disclaimerIds: ["ai-assessment", "user-decision"],
    degraded: false,
  };
}

function confirmationTurn(): AssistantTurn {
  return {
    state: "USER_REVIEW",
    message:
      "这段内容可能包含个人信息。请先选择保留原文、使用脱敏版本或删除相关片段。如果你正面临即时危险，可先查看静态紧急资源并暂停交流。",
    questions: ["确认处理方式后再继续，可以吗？"],
    actions: ["show_emergency_resources", "pause", "skip", "exit"],
    disclaimerIds: ["ai-assessment", "user-decision"],
    degraded: false,
  };
}

function fallbackTurn(state: ConversationState): AssistantTurn {
  return {
    state,
    message:
      "AI 服务目前不可用，本轮内容未写入档案。你可以稍后重试，或查看平台提供的静态安全与信息资源。",
    questions: [],
    actions: ["pause", "skip", "exit"],
    disclaimerIds: ["ai-assessment", "legal-reference", "user-decision"],
    degraded: true,
  };
}

async function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("AI provider deadline exceeded")), timeoutMs);
  });

  try {
    return await Promise.race([task, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function validationScope(
  context: ConversationContext,
  knowledgeSourceIds: readonly string[],
) {
  return {
    conversationMessageIds: context.sourceMessageIds,
    knowledgeSourceIds,
  };
}

async function buildPatchForState(
  provider: AiProvider,
  input: string,
  session: ConversationSession,
  knowledgeSourceIds: readonly string[],
  timeoutMs: number,
): Promise<CasePatch | undefined> {
  const scope = validationScope(session.context, knowledgeSourceIds);

  if (
    session.state === "WELCOME" ||
    session.state === "SAFETY_CHECK" ||
    session.state === "JURISDICTION_CONTEXT" ||
    session.state === "FACT_GATHERING"
  ) {
    const raw = await withDeadline(
      provider.extractFacts(input, session.context),
      timeoutMs,
    );
    const extraction = validateFactExtraction(raw, scope);
    return {
      jurisdiction: {
        ...session.context.jurisdiction,
        ...extraction.jurisdictionPatch,
      },
      facts: [...session.context.facts, ...extraction.facts],
      timeline: [...session.context.timeline, ...extraction.timeline],
    };
  }

  if (session.state === "ILO_MAPPING") {
    const raw = await withDeadline(
      provider.mapIndicators(input, session.context),
      timeoutMs,
    );
    return { iloIndicators: validateIndicatorAssessments(raw, scope) };
  }

  if (session.state === "EVIDENCE_COVERAGE") {
    const raw = await withDeadline(
      provider.summarizeCoverage(input, session.context),
      timeoutMs,
    );
    return { evidenceCoverage: validateEvidenceCoverage(raw, scope) };
  }

  return undefined;
}

export function createConversationOrchestrator(
  options: ConversationOrchestratorOptions,
): ConversationOrchestrator {
  const timeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const knowledgeSourceIds = options.knowledgeSourceIds ?? [];

  if (timeoutMs <= 0 || timeoutMs > DEFAULT_PROVIDER_TIMEOUT_MS) {
    throw new Error("AI provider timeout must be between 1 and 15000 milliseconds");
  }

  return {
    async handleMessage(input, session) {
      if (input.trim().length === 0 || input.length > MAX_INPUT_CHARACTERS) {
        throw new RangeError("Message length must be between 1 and 10,000 characters");
      }

      if (findLocalSafetyFlags(input).length > 0) {
        return safetyTurn();
      }

      try {
        const decision = await withDeadline(options.inputPolicy.prepare(input), timeoutMs);
        if (decision.kind === "confirmation_required") {
          return confirmationTurn();
        }

        const rawSafetyFlags = await withDeadline(
          options.provider.detectSafety(decision.text),
          timeoutMs,
        );
        const providerSafetyFlags = validateSafetyFlags(rawSafetyFlags);
        if (providerSafetyFlags.length > 0) {
          return safetyTurn();
        }

        const draftPatch = await buildPatchForState(
          options.provider,
          decision.text,
          session,
          knowledgeSourceIds,
          timeoutMs,
        );
        const nextState = transitionTable[session.state];
        const questions = [...questionsByState[nextState]].slice(0, 3);

        return {
          state: nextState,
          message: "我已把这轮内容整理为可核对的档案草稿。请检查表述是否准确；你可以修改、跳过或继续补充。",
          questions,
          actions: ["pause", "skip", "exit"],
          disclaimerIds: ["ai-assessment", "user-decision"],
          degraded: false,
          ...(draftPatch ? { draftPatch } : {}),
        };
      } catch (error) {
        if (error instanceof ModelInputConfirmationRequired) {
          return confirmationTurn();
        }
        return fallbackTurn(session.state);
      }
    },
  };
}
