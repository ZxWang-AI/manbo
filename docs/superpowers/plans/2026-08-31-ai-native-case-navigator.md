# AI-Native 强迫劳动举报档案与渠道导航实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个以 AI 对话为主要入口、能够生成可追溯结构化举报档案、长期保存用户材料、提供 AI 第一次初审与管理员审核、定性检查 ILO 指标与证据覆盖、提供法域法律导航并由用户控制导出的 MVP。

**Architecture:** 使用 Next.js App Router 作为模块化单体 Web 应用，配套独立媒体处理流水线、加密对象存储和供应商中立 AI Gateway，内部按 `domain`、`media`、`ai`、`knowledge`、`connectors` 和 `web` 模块分层。AI 只负责对话编排、结构化提取和工作流状态，所有法律导航必须经过带 `evidence_status`、`last_verified` 和 `source_id` 的知识库检索；业务层禁止数字评分、概率、排名和法律认定。首发 MVP 保存结构化档案、原始材料及不可变版本，支持管理员低频审核；公开页面、跨用户聚类和自动外部提交不进入本计划。

**Tech Stack:** Node.js 22 LTS、Next.js 16 App Router、React 19、TypeScript strict、PostgreSQL 16、Prisma 6、Zod 4、Ajv 8（JSON Schema）、Vitest 4、Playwright 1.62、pnpm 11。AI 通过 provider-neutral adapter 接入，测试默认使用 deterministic mock provider；MVP 不在核心包中安装任何模型厂商 SDK。

## Global Constraints

- AI 是主要用户入口，但不能输出“构成强迫劳动”“已经违法”“举报成功率”等法律或结果性结论。
- 系统禁止数字化证据分数、概率、排名、星级、颜色等级或报告热度排序。
- 允许的定性状态为：ILO 指标 `hit | not_hit | insufficient`；证据覆盖 `covered | partial | gap`；法律导航 `possible | needs_review | not_covered`。
- MVP 保存结构化举报档案、必要对话消息和用户主动上传的加密原始材料；不保存完整 IP 或设备指纹。
- 方案 A 首发范围允许加密保存原始图片、文件和录音；用户主动删除前无默认到期时间，单文件上限 100 MB、单案件上限 2 GB。
- 文件、录音、转写文本和用户修订稿分开保存；无法解析的材料可保存但不得进入 AI 判断，危险格式必须隔离且不执行。
- AI 初审结果固定为 `ready_for_preparation | needs_more_information | out_of_scope | safety_referral`，只表示下一步工作流。
- 管理员可随时查看并独立标注 `intake_rejected | evidence_incomplete | credibility_concern | demonstrably_false`；系统自动记录访问、播放、下载、标注、修改和删除，用户可查阅访问记录。
- 支持“语音输入+文字回复”和“实时语音+同步字幕”两种模式；音频原件、转写与编辑稿不可互相覆盖。
- 法域必须分别记录行为发生地、用户所在地和产品流向地；未确认法域时不得映射具体法条。
- 暴力、拘禁、自伤、未成年人或人口贩运信号优先进入危机流程，停止常规证据追问。
- 用户可查看、修改、删除和导出档案；外部系统提交必须逐字段预览并获得独立确认。
- 法律、渠道和动态清单只从带 `source_id`、`last_verified`、`evidence_status` 的知识库检索；`needs-review` 不得触发确定性法律表述。
- 公开公司页、地图、跨用户事件关联和 B2B API 不在 MVP 中；原始证据托管属于方案 A 首发能力，但受独立媒体安全门禁约束。
- 对话原文发送给模型前必须先做本地 PII 提示/脱敏；模型厂商、模型 ID、留存策略和区域必须由部署配置提供，不得写死在领域层。
- 所有时间戳使用 UTC ISO 8601，日期型知识元数据使用 `YYYY-MM-DD`；所有公开 API 对象都经过 Zod `.strict()` 校验。
- 用户界面目标为 WCAG 2.2 AA；键盘操作、焦点顺序、错误提示和危机退出属于发布阻断项。

## 版本、运行环境与锁定策略

| 类别 | 锁定值 | 规则 |
|------|--------|------|
| Runtime | Node.js `>=22.14.0 <23` | `.nvmrc` 固定 `22.14.0`，`package.json.engines` 同步约束 |
| Package manager | pnpm `11.24.0` | `packageManager` 精确锁定并提交 `pnpm-lock.yaml` |
| Web | Next.js `16.3.3`、React/React DOM `19.2.8` | 使用 App Router；不使用已移除的 `next lint` |
| Language | TypeScript `5.9.3` | `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 全部启用 |
| Data | PostgreSQL `16.15`、Prisma/Client `6.19.3` | 本地和 CI 使用同一 PostgreSQL 主版本；迁移文件必须提交 |
| Validation | Zod `4.5.4`、Ajv `8.20.0` | Zod 为运行时领域校验，Ajv 用于版本化 JSON Schema 兼容测试 |
| Tests | Vitest `4.1.11`、Playwright `1.62.1`、`@axe-core/playwright` `4.13.0` | 单元、集成、E2E、可及性分别有独立脚本 |
| Security | argon2 `0.45.1` | 只保存 Argon2id 恢复密钥哈希，不保存恢复密钥原文 |

所有直接依赖使用精确版本并通过 Renovate/Dependabot 单独升级；禁止 `latest`、`*`、未提交 lockfile 或在同一功能提交中顺带升级依赖。若某个精确版本因安全公告必须替换，应先更新本表、lockfile、依赖审计证据和回归测试结果。

## 文件与模块地图

### 应用与配置

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `.env.example`
- Create: `src/app/` 页面与 API Route Handlers
- Create: `src/server/` 服务端依赖注入、认证、数据库和安全策略

### 领域模型与校验

- Create: `src/domain/case-record.ts` 规范化 `CaseRecord` 类型和生命周期
- Create: `src/domain/assessment.ts` 指标、三要件和证据覆盖类型
- Create: `src/domain/consent.ts` 同意事件和字段共享策略
- Create: `src/domain/schemas.ts` Zod/Ajv schema

### AI 与知识库

- Create: `src/ai/provider.ts`, `src/ai/mock-provider.ts`, `src/ai/orchestrator.ts`
- Create: `src/ai/prompts/*.md`, `src/ai/output-contract.ts`
- Create: `src/knowledge/frontmatter.ts`, `src/knowledge/indexer.ts`, `src/knowledge/retriever.ts`
- Create: `src/knowledge/source-registry.json`

### 持久化与适配器

- Create: `prisma/schema.prisma`, `src/server/repositories/*.ts`
- Create: `src/media/storage/`, `src/media/security/`, `src/media/parsers/`, `src/media/transcription/`
- Create: `src/server/admin/`, `src/app/(admin)/admin/`, `src/app/api/admin/`
- Create: `src/connectors/connector.ts`, `src/connectors/export/markdown.ts`, `src/connectors/export/json.ts`
- Create: `src/server/audit.ts`, `src/server/redaction.ts`

### 测试与文档

- Create: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/fixtures/`
- Modify: `README.md`, `docs/research-and-plan.md`, `docs/release-gates.md`

## WBS 与实施任务

## 方案 A 增量 WBS（覆盖旧计划中与原始材料冲突的步骤）

| WBS | 目标 | 关键交付物 | 验收标准 |
|-----|------|------------|----------|
| A1 基础应用与契约 | 建立模块化单体、严格类型与版本化协议 | Next.js、PostgreSQL、Prisma、Zod/Ajv、`AiInputEnvelope`/`AiOutputEnvelope` | 所有公开输入输出 strict 校验；禁止评分/概率/排名字段 |
| A2 加密媒体存储 | 长期保存原始文件、录音和版本 | S3 兼容对象存储、信封加密、100 MB/2 GB 配额、完整性哈希 | 原件不可变；用户主动删除前无默认到期；超限原子拒绝 |
| A3 文件安全与解析 | 安全接收几乎所有格式 | MIME/签名校验、隔离扫描、OCR/转写/抽取适配器、解析状态机 | 无法解析标记“已保存、尚未读取”；危险格式永不执行、不进入 AI |
| A4 双模式语音 | 兼顾低频语音输入与实时对话 | 录音/转写/编辑/重录；双向音频/字幕/打断/文本切换 | 音频、转写和编辑稿独立版本；断线可恢复 |
| A5 AI Gateway | 实现供应商中立、可降级的 AI | 本地危机预检、PII 提示、来源追溯、双重 schema 校验 | 校验失败不生成正式初审；模型故障回退静态安全资源 |
| A6 案件与初审版本 | 支持持续补充与反复初审 | Case/Material/Transcript/ReviewVersion 模型 | 新材料不覆盖历史；四个 AI 状态只驱动工作流 |
| A7 用户工作台 | 达到 ChatGPT 类使用体验 | 连续消息流、流式/停止/重试/编辑重发、上传和初审卡片 | 桌面/移动可用；WCAG 2.2 AA；不展示结果性结论 |
| A8 管理员工作台 | 支持默认低频人工审核 | 随时查看、材料播放/下载、四类管理员标注、申诉 | 管理意见独立保存；操作自动审计；用户可查看访问记录 |
| A9 导出与未来连接器 | 用户控制材料准备与后续接入 | 字段预览、独立同意、Markdown/JSON/PDF、Connector 接口 | 无可验证回执不显示 received；聚合必须明确加入 |
| A10 生命周期与发布 | 证明删除、备份、审计和恢复可靠 | 删除回执、备份清理、密钥轮换、E2E、可及性与红队报告 | Gate 0/1/2 对应证据齐全，高危失败可回滚 |

执行顺序为 A1 → A2/A3 → A4/A5 → A6 → A7/A8 → A9 → A10；每个 WBS 仍按本计划的 TDD 步骤实施和独立审查。

### Task 1: 建立应用骨架与质量门槛

**Goal:** 让空仓库具备可重复安装、类型检查、单元测试和端到端测试入口。

**Dependencies:** 无。

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Create: `src/server/env.ts`
- Create: `tests/unit/health.test.ts`

**Interfaces:**
- Produces: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm axe:e2e`, `pnpm knowledge:index`, `pnpm db:test:up`, `pnpm db:test:down` 九个稳定命令。
- Consumes environment: `DATABASE_URL`, `SESSION_SECRET`, `APP_MODE`, `AI_PROVIDER`, `AI_GATEWAY_URL`, `AI_GATEWAY_TOKEN`, `AI_MODEL_ALIAS`, `AI_REGION`, `AI_RETENTION_POLICY_ID`; Task 1 只校验名称和格式，不发起模型请求。

- [ ] **Step 1: Write the failing health test**

```ts
import { describe, expect, it } from "vitest";

describe("application baseline", () => {
  it("exposes a deterministic test command", () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test before scaffolding**

Run: `pnpm test -- tests/unit/health.test.ts`
Expected: FAIL because the package scripts and Vitest configuration do not exist.

- [ ] **Step 3: Add the minimal project configuration**

先用以下命令精确安装依赖并生成 lockfile：

```powershell
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm add --save-exact next@16.3.3 react@19.2.8 react-dom@19.2.8 @prisma/client@6.19.3 zod@4.5.4 ajv@8.20.0 argon2@0.45.1 gray-matter@4.0.3
pnpm add -D --save-exact typescript@5.9.3 @types/node@22.20.1 @types/react@19.2.18 @types/react-dom@19.2.5 prisma@6.19.3 eslint@9.39.5 eslint-config-next@16.3.3 vitest@4.1.11 happy-dom@20.12.0 @playwright/test@1.62.1 @axe-core/playwright@4.13.0 tsx@4.23.13
```

Expected: `pnpm-lock.yaml` is created and every direct dependency has an exact version. `package.json` must then define this runtime contract and scripts:

```json
{
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": ">=22.14.0 <23", "pnpm": "11.24.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "axe:e2e": "playwright test tests/e2e/accessibility.spec.ts",
    "knowledge:index": "tsx scripts/build-knowledge-index.ts",
    "db:test:up": "docker compose up -d --wait test-db",
    "db:test:down": "docker compose down --volumes --remove-orphans",
    "prisma:generate": "prisma generate"
  }
}
```

`eslint.config.mjs` uses the ESLint 9 flat configuration and Next.js presets; do not call `next lint`. ESLint 9.39.5 is the newest 9.x compatible with the React plugins bundled by `eslint-config-next@16.3.3`; ESLint 10.9.1 causes `react/display-name` to fail while loading because the plugin peer contract only supports ESLint 9:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "coverage/**", "playwright-report/**", "src/knowledge/source-registry.json"]),
]);
```

Configure `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, and the `@/*` path alias. `vitest.config.ts` uses `happy-dom`, resolves `@` to `src`, and includes `tests/unit/**/*.test.ts`; `playwright.config.ts` starts `pnpm dev` on `127.0.0.1:3000`. `src/server/env.ts` uses a strict Zod discriminated union: `AI_PROVIDER=mock` requires no credential and is rejected when `NODE_ENV=production`; `AI_PROVIDER=gateway` requires HTTPS `AI_GATEWAY_URL`, token, model alias, region, and a reviewed retention-policy ID. `APP_MODE` is `normal | static`; `static` forbids persistence and model calls. `.env.example` contains names and safe local examples only, never a working secret.

- [ ] **Step 4: Run all baseline checks**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: PASS with one health test, zero ESLint warnings, and a successful production build.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc tsconfig.json next.config.ts eslint.config.mjs vitest.config.ts playwright.config.ts .env.example src/app tests/unit/health.test.ts src/server/env.ts
git commit -m "chore: scaffold AI-native case navigator"
```

**Acceptance Criteria:**

- Fresh checkout can run the nine Task 1 scripts without manual file edits (database scripts require Docker Desktop running).
- No API key or credential is present in tracked files.
- `src/app/page.tsx` says the application is a private report-preparation tool and does not claim public reporting is available.

### Task 2: Define the domain model and non-scoring output contract

**Goal:** 建立所有后续模块共用的强类型模型，确保“无分数、无法律认定”在类型层面可验证。

**Dependencies:** Task 1。

**Files:**
- Create: `src/domain/assessment.ts`
- Create: `src/domain/case-record.ts`
- Create: `src/domain/consent.ts`
- Create: `src/domain/schemas.ts`
- Create: `src/domain/case-record.schema.json`
- Create: `tests/unit/domain-schemas.test.ts`
- Create: `tests/fixtures/case-record.ts`

**Interfaces:**

```ts
export type IndicatorStatus = "hit" | "not_hit" | "insufficient";
export type CoverageStatus = "covered" | "partial" | "gap";
export type ElementStatus = "covered" | "partial" | "unknown";
export type LegalStatus = "possible" | "needs_review" | "not_covered";
export type LifecycleStatus = "draft" | "confirmed" | "exported" | "deleted";
export type SafetyFlag = "violence" | "confinement" | "self_harm" | "minor" | "trafficking";

export interface JurisdictionContext {
  incidentCountry?: string;
  userCountry?: string;
  productDestination?: string;
}

export interface FactItem {
  id: string;
  field: string;
  value: string;
  sourceMessageIds: string[];
  sourceQuote: string;
  certainty: "user_stated" | "uncertain";
}

export interface TimelineItem {
  id: string;
  occurredAt?: string;
  description: string;
  sourceMessageIds: string[];
}

export interface IndicatorAssessment {
  indicatorId: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  status: IndicatorStatus;
  basis: SourceTrace[];
  missing: string[];
}

export interface ElementItem { status: ElementStatus; basis: SourceTrace[]; missing: string[] }
export interface ElementAssessment {
  workOrService: ElementItem;
  involuntary: ElementItem;
  penaltyOrThreat: ElementItem;
}

export interface EvidenceCoverageItem {
  topic: "entity_facility" | "timeline" | "work_relationship" | "coercive_conduct" | "pay_hours" | "product_flow" | "supporting_material";
  status: CoverageStatus;
  explanation: string;
  sourceMessageIds: string[];
  safeOptions: string[];
}

export interface LegalNavigationItem {
  jurisdiction: string;
  sourceId: string;
  status: LegalStatus;
  premise: string;
  lastVerified: string;
  stale: boolean;
  officialUrl?: string;
}

export interface ReferralOption {
  sourceId: string;
  name: string;
  officialUrl: string;
  anonymity: "supported" | "not_supported" | "unknown";
  feedback: "expected" | "not_expected" | "unknown";
  userSteps: string[];
}

export interface SourceTrace {
  kind: "conversation" | "knowledge";
  id: string;
  quote?: string;
}

export interface ConsentSnapshot {
  version: string;
  saveCase: boolean;
  externalSharing: boolean;
  confirmedFieldPaths: string[];
}

export interface CaseRecord {
  schemaVersion: "1.0";
  caseId: string;
  accountId: string;
  visibility: "private";
  lifecycle: LifecycleStatus;
  version: number;
  jurisdiction: JurisdictionContext;
  facts: FactItem[];
  timeline: TimelineItem[];
  iloIndicators: IndicatorAssessment[];
  elements: ElementAssessment;
  evidenceCoverage: EvidenceCoverageItem[];
  legalNavigation: LegalNavigationItem[];
  referrals: ReferralOption[];
  safetyFlags: SafetyFlag[];
  sourceTrace: SourceTrace[];
  consent: ConsentSnapshot;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type CaseDraft = Omit<CaseRecord, "caseId" | "accountId" | "createdAt" | "updatedAt" | "deletedAt" | "version">;
export type CasePatch = Partial<Pick<CaseRecord,
  "jurisdiction" | "facts" | "timeline" | "iloIndicators" | "elements" |
  "evidenceCoverage" | "legalNavigation" | "referrals" | "safetyFlags" |
  "sourceTrace" | "consent" | "lifecycle"
>>;
```

- [ ] **Step 1: Write schema tests that reject scoring fields**

```ts
import { describe, expect, it } from "vitest";
import { caseRecordSchema } from "@/domain/schemas";
import { makeCaseRecordFixture } from "../fixtures/case-record";

describe("CaseRecord schema", () => {
  it("accepts qualitative statuses", () => {
    const validRecord = {
      caseId: "MB-test",
      accountId: "acct-test",
      schemaVersion: "1.0",
      visibility: "private",
      lifecycle: "draft",
      version: 1,
      jurisdiction: {},
      facts: [],
      timeline: [],
      iloIndicators: [],
      elements: {
        workOrService: { status: "unknown", basis: [], missing: [] },
        involuntary: { status: "unknown", basis: [], missing: [] },
        penaltyOrThreat: { status: "unknown", basis: [], missing: [] }
      },
      evidenceCoverage: [],
      legalNavigation: [],
      referrals: [],
      safetyFlags: [],
      sourceTrace: [],
      consent: { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    } as const;
    const parsed = caseRecordSchema.parse(validRecord);
    expect(parsed.visibility).toBe("private");
  });

  it("rejects score, probability, rank, and successRate keys", () => {
    const validRecord = makeCaseRecordFixture();
    expect(() => caseRecordSchema.parse({ ...validRecord, score: 0.8 })).toThrow();
    expect(() => caseRecordSchema.parse({ ...validRecord, probability: 0.8 })).toThrow();
    expect(() => caseRecordSchema.parse({ ...validRecord, rank: 1 })).toThrow();
    expect(() => caseRecordSchema.parse({ ...validRecord, successRate: 0.8 })).toThrow();
  });
});
```

- [ ] **Step 2: Run the schema tests to verify they fail**

Run: `pnpm test -- tests/unit/domain-schemas.test.ts`
Expected: FAIL because `caseRecordSchema` and domain types are not defined.

- [ ] **Step 3: Implement strict Zod schemas**

Implement every interface above from one set of Zod schemas using `z.infer`; do not duplicate handwritten runtime and compile-time shapes. Use `.strict()` on every public object, `z.iso.datetime()` for timestamps, `z.iso.date()` for verification dates, `z.record()` nowhere in the public contract, and `z.never()` for explicitly prohibited keys in the negative-test helper. Generate `src/domain/case-record.schema.json` from the same status constants and validate the golden fixture with Ajv in the test. Do not add numeric assessment fields.

- [ ] **Step 4: Run the schema tests**

Run: `pnpm test -- tests/unit/domain-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/unit/domain-schemas.test.ts tests/fixtures/case-record.ts
git commit -m "feat: define non-scoring case record contract"
```

**Acceptance Criteria:**

- All domain objects are strict and serializable.
- No exported type includes `score`, `probability`, `rank`, `rating`, `successRate`, or equivalent fields.
- Every assessment item carries a source/basis or an explicit missing-information list.

### Task 3: Index the knowledge base with source status and expiry

**Goal:** 将 26 个 Markdown 知识库文件转换为可检索、可核验、可过期降级的 source registry。

**Dependencies:** Task 2。

**Files:**
- Create: `src/knowledge/frontmatter.ts`
- Create: `src/knowledge/indexer.ts`
- Create: `src/knowledge/retriever.ts`
- Create: `src/knowledge/source-registry.json`
- Create: `scripts/build-knowledge-index.ts`
- Create: `tests/unit/knowledge-indexer.test.ts`
- Create: `tests/fixtures/knowledge/verified.md`
- Create: `tests/fixtures/knowledge/needs-review.md`

**Interfaces:**

```ts
export interface KnowledgeRegistryEntry {
  sourceId: string;
  title: string;
  jurisdiction: string;
  evidenceStatus: "verified" | "design" | "needs-review";
  lastVerified: string;
  excerpt: string;
  sourceUrl?: string;
}

export interface KnowledgeHit extends KnowledgeRegistryEntry {
  stale: boolean;
  warning?: "needs_review" | "design_source" | "stale";
}

export interface KnowledgeDocument {
  sourceId: string;
  title: string;
  jurisdiction: string;
  evidenceStatus: "verified" | "design" | "needs-review";
  lastVerified: string;
  excerpt: string;
  authority: string;
  sourceUrls: string[];
}

export function parseKnowledgeFile(path: string, markdown: string): KnowledgeDocument;
export function isStale(lastVerified: string, now: Date, maxAgeDays?: number): boolean;
export function buildKnowledgeRegistry(rootDir: string): Promise<KnowledgeRegistryEntry[]>;

export interface KnowledgeRetriever {
  search(query: string, options?: { jurisdiction?: string; now?: Date }): Promise<KnowledgeHit[]>;
}
```

- [ ] **Step 1: Write parser and expiry tests**

```ts
it("parses evidence_status and marks a source stale after 90 days", () => {
  const hit = parseKnowledgeFile("knowledge-base/test/verified.md", verifiedFixture);
  expect(hit.evidenceStatus).toBe("verified");
  expect(isStale(hit.lastVerified, new Date("2026-12-01"))).toBe(true);
});

it("never promotes needs-review to verified", () => {
  const hit = parseKnowledgeFile("knowledge-base/test/needs-review.md", needsReviewFixture);
  expect(hit.evidenceStatus).toBe("needs-review");
});
```

- [ ] **Step 2: Run the tests before implementation**

Run: `pnpm test -- tests/unit/knowledge-indexer.test.ts`
Expected: FAIL because parser and retriever are missing.

- [ ] **Step 3: Implement frontmatter parsing and registry generation**

Implement `parseKnowledgeFile(path, markdown)` with `gray-matter` and a strict Zod schema for `id`, `title`, `jurisdiction`, `authority`, `last_verified`, `evidence_status`, and `sources`. Each `sources` entry is classified as an HTTPS URL, a normalized relative repository path that must exist, or a non-link citation string; legal/channel entries must contain at least one HTTPS official source before they can be returned for navigation. Reject missing fields, duplicate IDs, invalid dates, unsafe paths, malformed URLs, or text outside `knowledge-base/**/*.md`. `buildKnowledgeRegistry()` sorts by `sourceId` before serialization so the checked-in JSON is deterministic. Store only excerpts and extracted official URLs in `source-registry.json`; do not copy dynamic entity-list quantities or runtime `stale/warning` fields.

- [ ] **Step 4: Implement retrieval filtering**

`search(query, options)` tokenizes normalized Chinese/English text without embeddings in MVP, filters by `options.jurisdiction` when provided, derives `stale` at read time from `options.now ?? new Date()`, and sets warnings by precedence `stale` → `needs_review` → `design_source`. Empty query returns `[]`; a legal hit missing `sourceId`, `lastVerified`, `sourceUrl`, or jurisdiction is dropped and recorded as an indexing error. `scripts/build-knowledge-index.ts` calls `buildKnowledgeRegistry("knowledge-base")`, writes the stable JSON, and exits non-zero on any invalid file.

- [ ] **Step 5: Run tests and index the repository knowledge base**

Run: `pnpm test -- tests/unit/knowledge-indexer.test.ts && pnpm knowledge:index`
Expected: PASS; registry contains all 26 knowledge-base files and no unresolved source reference.

- [ ] **Step 6: Commit**

```bash
git add src/knowledge scripts/build-knowledge-index.ts tests/unit/knowledge-indexer.test.ts tests/fixtures/knowledge
git commit -m "feat: add traceable knowledge retrieval"
```

**Acceptance Criteria:**

- A legal answer cannot be produced without `sourceId`, jurisdiction, evidence status, and verification date.
- Sources older than 90 days are marked stale and surfaced to the caller.
- `needs-review` and `design` sources cannot be used as verified legal facts.

### Task 4: Implement provider-neutral AI orchestration and crisis-first state machine

**Goal:** 让 AI 对话按安全优先状态机运行，并在模型失败时降级到静态知识库。

**Dependencies:** Tasks 2–3。

**Files:**
- Create: `src/ai/provider.ts`
- Create: `src/ai/mock-provider.ts`
- Create: `src/ai/gateway-provider.ts`
- Create: `src/ai/orchestrator.ts`
- Create: `src/ai/output-contract.ts`
- Create: `src/ai/prompts/system.md`
- Create: `src/ai/prompts/crisis.md`
- Create: `tests/unit/ai-orchestrator.test.ts`
- Create: `tests/fixtures/ai/crisis-message.json`
- Create: `tests/fixtures/ai/ordinary-message.json`
- Create: `tests/fixtures/ai/session.ts`

**Interfaces:**

```ts
export type ConversationState =
  | "WELCOME" | "SAFETY_CHECK" | "JURISDICTION_CONTEXT"
  | "FACT_GATHERING" | "ILO_MAPPING" | "EVIDENCE_COVERAGE"
  | "LEGAL_NAVIGATION" | "CHANNEL_OPTIONS" | "USER_REVIEW"
  | "SAVE_OR_EXPORT" | "SAFETY_ESCALATION";

export interface ConversationContext {
  jurisdiction: JurisdictionContext;
  facts: FactItem[];
  timeline: TimelineItem[];
  sourceMessageIds: string[];
}

export interface FactExtraction {
  facts: FactItem[];
  timeline: TimelineItem[];
  jurisdictionPatch: Partial<JurisdictionContext>;
}

export interface ConversationSession {
  sessionId: string;
  state: ConversationState;
  context: ConversationContext;
  draft?: CaseDraft;
}

export interface AssistantTurn {
  state: ConversationState;
  message: string;
  questions: string[];
  actions: Array<"pause" | "skip" | "exit" | "show_emergency_resources">;
  disclaimerIds: Array<"ai-assessment" | "legal-reference" | "user-decision">;
  degraded: boolean;
  draftPatch?: CasePatch;
}

export interface AiProvider {
  detectSafety(input: string): Promise<SafetyFlag[]>;
  extractFacts(input: string, context: ConversationContext): Promise<FactExtraction>;
  mapIndicators(input: string, context: ConversationContext): Promise<IndicatorAssessment[]>;
  summarizeCoverage(input: string, context: ConversationContext): Promise<EvidenceCoverageItem[]>;
}

export interface GatewayTurnRequest {
  requestId: string;
  operation: "detect_safety" | "extract_facts" | "map_indicators" | "summarize_coverage";
  schemaVersion: "1.0";
  locale: string;
  input: string;
  context: ConversationContext;
}

export interface GatewayTurnResponse { requestId: string; output: unknown }

export type ModelInputDecision =
  | { kind: "approved"; text: string; basis: "no_hint" | "redacted" | "user_confirmed" }
  | { kind: "confirmation_required"; hintIds: string[] };

export interface ModelInputPolicy {
  prepare(input: string): Promise<ModelInputDecision>;
}

export interface ConversationOrchestrator {
  handleMessage(input: string, session: ConversationSession): Promise<AssistantTurn>;
}
```

- [ ] **Step 1: Write crisis precedence tests**

```ts
it("switches to safety escalation before evidence questions", async () => {
  const turn = await orchestrator.handleMessage("他们把我锁起来，还打我", makeOrdinarySession());
  expect(turn.state).toBe("SAFETY_ESCALATION");
  expect(turn.questions).toHaveLength(0);
  expect(turn.actions).toContain("show_emergency_resources");
});

it("limits ordinary turns to three questions", async () => {
  const turn = await orchestrator.handleMessage("我被要求长期加班", makeOrdinarySession());
  expect(turn.questions.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 2: Run crisis tests before implementation**

Run: `pnpm test -- tests/unit/ai-orchestrator.test.ts`
Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement state machine and deterministic mock provider**

Create an explicit transition table keyed by `ConversationState`; do not let the model choose arbitrary next states. `handleMessage()` first checks message length (`1..10_000` characters), then runs a local deterministic safety phrase/rule screen before any gateway call. A local hit transitions directly to `SAFETY_ESCALATION`, emits only safety confirmation/local-resource lookup guidance, uses actions `show_emergency_resources`, `pause`, `exit`, and sends no text externally. If the local screen does not hit, `ModelInputPolicy.prepare()` must approve/redact the text before `AiProvider.detectSafety()` runs with a 15-second deadline; only after it returns no `SafetyFlag` may any fact/evidence method run. Any returned flag still preempts the flow. Ordinary transitions may emit at most three questions. Provider timeout, refusal, empty output, or schema failure returns the version-controlled static fallback with `degraded: true` and does not mutate the draft.

Implement `GatewayAiProvider` against a platform-owned HTTPS gateway contract: `POST /v1/structured-turn`, Bearer token, `X-Model-Alias`, `X-Data-Region`, and `X-Retention-Policy-Id` headers, `GatewayTurnRequest` body, and `GatewayTurnResponse` body. It requires a `ModelInputPolicy`; only `kind="approved"` may be sent, while `confirmation_required` returns a user-review turn without a gateway call. Set 15-second timeout, maximum 256 KiB response, no automatic retry for safety/extraction calls, and redact headers/body from logs. A Node test server asserts request/response behavior without calling a real model. Task 9 must be complete before `gateway` is enabled with real user text; `MockAiProvider` remains the only E2E test provider.

- [ ] **Step 4: Implement output contract validation**

Validate every provider response with the Task 2 schema and `src/ai/output-contract.ts`. Reject unknown keys, any numeric assessment field, prohibited legal-conclusion phrases, message IDs absent from the session, or knowledge IDs absent from the registry. Do not silently repair a provider response; return a safe fallback. The core module receives an `AiProvider` instance through dependency injection and ships `MockAiProvider` plus the vendor-neutral `GatewayAiProvider`; the deployment gateway owns vendor SDK/model selection, so no vendor SDK or vendor model ID appears in the application repository.

- [ ] **Step 5: Run tests**

Run: `pnpm test -- tests/unit/ai-orchestrator.test.ts`
Expected: PASS for crisis precedence, three-question limit, provider failure fallback, and score-field rejection.

- [ ] **Step 6: Commit**

```bash
git add src/ai tests/unit/ai-orchestrator.test.ts tests/fixtures/ai
git commit -m "feat: add crisis-first AI orchestration"
```

**Acceptance Criteria:**

- Crisis signals always preempt evidence gathering.
- Ordinary turns ask no more than three questions.
- Provider failure never produces a false “saved”, “submitted”, or legal conclusion state.
- No AI response contains numeric score, probability, ranking, or success-rate fields.

### Task 5: Add pseudonymous authentication and private CaseRecord persistence

**Goal:** 让用户能够创建不要求邮箱的化名账户，并长期保存自己的结构化举报档案。

**Dependencies:** Tasks 1–4。

**Files:**
- Create: `compose.yaml`
- Create: `vitest.integration.config.ts`
- Create: `prisma/migrations/202608310001_init_case_records/migration.sql`
- Create: `prisma/schema.prisma`
- Create: `src/server/auth.ts`
- Create: `src/server/db.ts`
- Create: `src/server/repositories/account-repository.ts`
- Create: `src/server/repositories/case-repository.ts`
- Create: `src/server/repositories/private-case-lock.ts`
- Create: `src/server/repositories/message-repository.ts`
- Create: `src/server/repositories/consent-repository.ts`
- Create: `tests/setup/integration.ts`
- Create: `tests/integration/case-repository.test.ts`
- Create: `tests/unit/case-history.test.ts`
- Create: `tests/unit/persistence-races.test.ts`
- Create: `tests/unit/test-database-guard.test.ts`

**Interfaces:**

```ts
export interface CaseRepository {
  createDraft(accountId: string, draft: CaseDraft): Promise<CaseRecord>;
  getPrivate(accountId: string, caseId: string): Promise<CaseRecord | null>;
  getVersionPrivate(accountId: string, caseId: string, version: number): Promise<CaseRecord | null>;
  updatePrivate(accountId: string, caseId: string, patch: CasePatch, expectedVersion: number): Promise<CaseRecord>;
  markDeleted(accountId: string, caseId: string): Promise<void>;
}

export interface AuthSession {
  accountId: string;
  sessionId: string;
  expiresAt: string;
}

export interface AccountRepository {
  createPseudonymous(): Promise<{ accountId: string; alias: string; recoverySecret: string }>;
  recover(alias: string, recoverySecret: string): Promise<AuthSession | null>;
}
```

- [ ] **Step 1: Write persistence tests**

```ts
it("does not allow another account to read a private case", async () => {
  const record = await repository.createDraft("acct-a", draftCase);
  await expect(repository.getPrivate("acct-b", record.caseId)).resolves.toBeNull();
});

it("deletion changes lifecycle and excludes the record from reads", async () => {
  const record = await repository.createDraft("acct-a", draftCase);
  await repository.markDeleted("acct-a", record.caseId);
  await expect(repository.getPrivate("acct-a", record.caseId)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run integration tests before schema implementation**

Run: `pnpm db:test:up; pnpm test:integration -- tests/integration/case-repository.test.ts`
Expected: FAIL because Prisma schema, migration, and repositories are missing; then run `pnpm db:test:down` to remove the isolated test database.

- [ ] **Step 3: Implement Prisma models**

Create Prisma models `Account`, `CaseRecord`, `CaseRecordRevision`, `ConversationMessage`, `ConsentEvent`, `AuditEvent`, and `CleanupJob`. `CaseRecord` stores the current Task 2 arrays/objects in JSON columns and validates them with Zod on every repository ingress/egress; every create, update, consent change, AI review, and deletion also appends a Zod-validated immutable `CaseRecordRevision` snapshot in the same transaction. `visibility` is constrained to `private`, `lifecycle` supports `draft`, `confirmed`, `exported`, `deleted`, and `version` is incremented atomically. Add indexes only on `(accountId, lifecycle)`, `(caseId, accountId)`, `(caseId, version)`, cleanup status, and timestamps—never on narrative text or company names. Task 5 只建立身份、案件和消息基线；原始材料元数据与对象存储由 Task 5A–5C 增量迁移实现。不得创建 public report、ranking 或 event-cluster 表。

`compose.yaml` defines only an isolated `postgres:16.15-bookworm` service named `test-db`, database `manbo_test`, port `55432`, a healthcheck using `pg_isready`, and a named test volume. `vitest.integration.config.ts` includes only `tests/integration/**/*.test.ts`, sets `fileParallelism: false`, injects the local test URL when `DATABASE_URL` is absent, and loads `tests/setup/integration.ts`; setup requires an explicit destructive-test confirmation and accepts only the fixed `manbo`/`manbo_test`/`public` combination on `127.0.0.1:55432`, `localhost:55432`, or the Compose host `test-db:5432`. Any other host, port, user, database, or schema aborts before cleanup.

- [ ] **Step 4: Implement pseudonymous credentials**

Generate a 128-bit random `accountId`, human-readable random alias, and 256-bit recovery secret with `node:crypto`; return the recovery secret exactly once and store only an Argon2id hash. Do not require email or phone. Recovery uses a constant-time Argon2 verification path and rate-limits by alias hash without storing IP/device identifiers. Explain that losing the recovery secret prevents account recovery. Session cookies must be random opaque IDs, stored server-side as hashes, `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`, and expire after 30 minutes of inactivity or 12 hours absolute.

- [ ] **Step 5: Implement ownership-checked repositories**

Every read/update/delete query includes both `accountId` and `caseId`; deleted records are excluded by default. `updatePrivate()` uses `updateMany({ where: { accountId, caseId, version: expectedVersion, deletedAt: null } })` and throws `ConcurrencyConflict` when the affected row count is zero. Message append, consent change, and deletion share a parent-row `FOR UPDATE` protocol so deletion cannot commit through an in-flight child write. Consent changes update `CaseRecord.consent`, increment the case version, append the immutable consent event and case revision, and audit the action atomically. Recovery session issuance locks and rechecks the current throttle row after Argon2 verification before it creates a session; unknown aliases take the dummy Argon2 path without creating unbounded throttle rows. The user-scoped message API accepts only `role=user`. Persist minimal audit events without IP, device identifiers, narrative, fact values, or source quotes.

- [ ] **Step 6: Run integration tests and migrations**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
pnpm exec prisma generate
pnpm exec prisma migrate dev --name init_case_records
pnpm test:integration
pnpm db:test:down
Remove-Item Env:DATABASE_URL
```

Expected: PostgreSQL healthcheck passes; migration is created; integration suite passes; cross-account read returns `null`, stale versions raise `ConcurrencyConflict`, deleted records are absent, v1 remains readable after v2 is created, consent snapshots cannot diverge, child writes cannot cross a committed deletion boundary, and the test container/volume is removed.

- [ ] **Step 7: Commit**

```bash
git add compose.yaml vitest.integration.config.ts prisma src/server tests/setup/integration.ts tests/integration/case-repository.test.ts
git commit -m "feat: persist private pseudonymous case records"
```

**Acceptance Criteria:**

- Users can create a pseudonymous account without email/phone.
- A case is private by schema and repository enforcement, not only by UI convention.
- Each accepted case or AI-review change appends an immutable validated revision; later updates never overwrite history.
- Task 5 的案件基线可由 Task 5A–5C 安全扩展为原始材料托管；不得出现绕过配额、加密或扫描的直接持久化端点。
- Delete, export, and update operations are auditable without storing IP/device identifiers.

### Task 5A: Add encrypted object storage and atomic case quotas

**Goal:** 在用户主动删除前长期保存原始文件与录音，同时用服务端信封加密、完整性校验和数据库配额预留强制执行单文件 100 MB、单案件 2 GB 上限。

**Dependencies:** Task 5。

**Files:**
- Create: `prisma/migrations/202608310002_add_material_storage/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `src/domain/material.ts`
- Create: `src/media/storage/object-store.ts`
- Create: `src/media/storage/s3-object-store.ts`
- Create: `src/media/storage/envelope-encryption.ts`
- Create: `src/server/repositories/material-repository.ts`
- Create: `src/server/services/material-upload-service.ts`
- Create: `src/app/api/cases/[caseId]/materials/uploads/route.ts`
- Create: `src/app/api/cases/[caseId]/materials/uploads/[uploadId]/complete/route.ts`
- Create: `tests/integration/material-storage.test.ts`

**Interfaces:**

```ts
export const MAX_MATERIAL_BYTES = 100 * 1024 * 1024;
export const MAX_CASE_MATERIAL_BYTES = 2 * 1024 * 1024 * 1024;

export interface MaterialUploadReservation {
  uploadId: string;
  caseId: string;
  materialId: string;
  reservedBytes: number;
  expiresAt: string;
  uploadTarget: MultipartUploadTarget;
}

export interface MaterialObjectStore {
  beginEncryptedUpload(input: BeginObjectUpload): Promise<MultipartUploadTarget>;
  completeEncryptedUpload(input: CompleteObjectUpload): Promise<{ objectKey: string; sha256: string; storedBytes: number }>;
  abortUpload(uploadId: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing quota, ownership, encryption, and immutability tests**

```ts
it("atomically rejects reservations that would exceed the case quota", async () => {
  await reserveUpload({ accountId: "acct-a", caseId: "case-a", byteLength: MAX_CASE_MATERIAL_BYTES - 1 });
  await expect(reserveUpload({ accountId: "acct-a", caseId: "case-a", byteLength: 2 }))
    .rejects.toThrow("CASE_STORAGE_LIMIT_EXCEEDED");
});

it("never persists an unencrypted material object", async () => {
  const result = await completeUpload(validCompletedUpload);
  expect(result.encryption).toMatchObject({ scheme: "AES-256-GCM", keyVersion: expect.any(String) });
  expect(fakeObjectStore.putPlaintextCalls).toBe(0);
});
```

另外覆盖：`100 MB + 1 byte` 原子拒绝、20 个并发预留只有配额内请求成功、跨账户完成/中止返回同一 404、上传字节数与声明不符时释放预留、原件 metadata 与 object key 不可 PATCH 覆盖。

- [ ] **Step 2: Run focused tests before implementation**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
pnpm test:integration -- tests/integration/material-storage.test.ts
pnpm db:test:down
Remove-Item Env:DATABASE_URL
```

Expected: FAIL because material schema, object-store adapter, quota reservation, and routes do not exist.

- [ ] **Step 3: Implement the material metadata model and atomic quota reservation**

Add `CaseStorageUsage`, `Material`, `MaterialUploadReservation`, and `MaterialObjectVersion`. `Material` belongs to both `caseId` and the owning account through the case relation; the repository always checks both. In one PostgreSQL transaction, lock/upsert the case usage row, reject negative/unknown lengths, reject `byteLength > 100 MB`, reject `usedBytes + reservedBytes + byteLength > 2 GB`, and increment `reservedBytes`. Completion moves exactly the verified stored byte count from reserved to used; abort/expiry releases it idempotently. Never rely on a UI counter or S3-reported quota alone.

Materials default to no expiry (`expiresAt = null`) and remain until user deletion. Original object versions are append-only: replacement creates a new `MaterialObjectVersion`; no update mutates an existing object key, hash, size, encryption metadata, or upload timestamp.

- [ ] **Step 4: Implement envelope-encrypted multipart storage**

Use an S3-compatible private bucket with public access blocked, TLS-only policy, versioning, and no default lifecycle expiration. Generate a unique data-encryption key per object, encrypt with AES-256-GCM, wrap it with the configured KMS/KEK version, and persist only wrapped-key metadata and authentication tag. Object keys use random IDs and never contain case IDs, account aliases, filenames, employers, or user text. Completion streams SHA-256 verification, validates actual bytes against the reservation, and finalizes metadata only after the encrypted object is durable; failure aborts the multipart upload and releases the reservation through an idempotent cleanup job.

- [ ] **Step 5: Run tests, migration, and storage contract checks**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
$env:OBJECT_STORE_ENDPOINT = "http://127.0.0.1:59000"
pnpm exec prisma migrate deploy
pnpm test:integration -- tests/integration/material-storage.test.ts
pnpm typecheck
pnpm db:test:down
Remove-Item Env:DATABASE_URL, Env:OBJECT_STORE_ENDPOINT
```

Expected: PASS; concurrent reservations never exceed 2 GB, oversized files are rejected before upload, all durable objects expose encryption/key-version and SHA-256 metadata, and failed uploads release reserved bytes exactly once.

- [ ] **Step 6: Commit**

```bash
git add prisma src/domain/material.ts src/media/storage src/server/repositories/material-repository.ts src/server/services/material-upload-service.ts src/app/api/cases tests/integration/material-storage.test.ts
git commit -m "feat: add encrypted case material storage"
```

**Acceptance Criteria:**

- The backend atomically enforces 100 MB per file and 2 GB per case under concurrent requests.
- Every persisted object is private, envelope-encrypted, integrity-hashed, and owned through the case/account boundary.
- Original object versions are immutable and have no default expiration; only user deletion starts cleanup.
- Interrupted, expired, and size-mismatched uploads cannot leak quota or create readable partial materials.

### Task 5B: Add quarantine scanning, type detection, and safe parsing states

**Goal:** 允许几乎所有格式被安全保存，同时把材料读取资格与保存成功分开：未通过检测和恶意扫描的内容永远不得进入解析器或 AI。

**Dependencies:** Task 5A。

**Files:**
- Create: `prisma/migrations/202608310003_add_material_processing/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/domain/material.ts`
- Create: `src/media/security/file-signature.ts`
- Create: `src/media/security/malware-scanner.ts`
- Create: `src/media/security/quarantine-service.ts`
- Create: `src/media/parsers/parser-registry.ts`
- Create: `src/media/parsers/safe-extraction-worker.ts`
- Create: `src/server/services/material-processing-service.ts`
- Create: `src/app/api/cases/[caseId]/materials/[materialId]/route.ts`
- Create: `tests/integration/material-processing.test.ts`
- Create: `tests/fixtures/materials/README.md`

**Interfaces:**

```ts
export type MaterialProcessingState =
  | "uploading"
  | "quarantined"
  | "scanning"
  | "saved_unread"
  | "parse_queued"
  | "parsed"
  | "blocked_malicious"
  | "scan_failed";

export interface MaterialReadiness {
  materialId: string;
  declaredMime: string | null;
  detectedMime: string | null;
  signatureStatus: "match" | "mismatch" | "unknown";
  processingState: MaterialProcessingState;
  eligibleForAi: boolean;
}
```

- [ ] **Step 1: Write failing adversarial processing tests**

```ts
it("saves an unsupported format but keeps it unread and out of AI", async () => {
  const material = await processFixture("sample.unknown");
  expect(material.processingState).toBe("saved_unread");
  expect(material.eligibleForAi).toBe(false);
});

it("never parses a signature-mismatched executable", async () => {
  const material = await processFixture("invoice.pdf.exe-as-pdf");
  expect(material.processingState).toBe("quarantined");
  expect(fakeParser.calls).toHaveLength(0);
});
```

覆盖 MIME 伪造、polyglot、ZIP/RAR/7z、邮件包、密码压缩包、DOCM/XLSM、EXE/DLL、脚本、超大解压比、嵌套归档、恶意扫描超时、解析器崩溃和重试幂等性。测试夹具必须是无害合成样本，不提交真实恶意代码或用户材料。

- [ ] **Step 2: Run processing tests before implementation**

Run: `pnpm test:integration -- tests/integration/material-processing.test.ts`

Expected: FAIL because signature detection, scanner adapter, quarantine state machine, and parser registry are missing.

- [ ] **Step 3: Implement detection and quarantine state transitions**

Keep every completed upload in the private encrypted quarantine namespace first. Compare declared MIME, extension, magic bytes, container structure, and scanner verdict; record mismatches without trusting the browser header. Scans run in an isolated worker with no outbound network and read-only input. EXE/DLL/scripts/macros, encrypted archives, scanner errors/timeouts, suspicious polyglots, excessive decompression ratios, and nested archives remain quarantined or blocked; they are never executed or directly parsed. State transitions use optimistic versioning and an allowlisted transition table so retries cannot change `blocked_malicious` back to readable.

- [ ] **Step 4: Implement capability-based parsing and “saved, not yet read” behavior**

Parser adapters declare exact signatures/MIME families, size/resource limits, sandbox profile, and output schema. Supported clean files move to `parse_queued` and then `parsed`; unsupported but non-malicious files move to `saved_unread` and display “已保存、尚未读取”. Parser failure does not delete the original and does not silently mark it read. Only `parsed` derivatives with their own hash, parser version, source material version, and source spans can be returned by `listAiEligibleContentRefs()`; all other states return no AI content reference.

- [ ] **Step 5: Run tests and parser isolation checks**

Run:

```powershell
pnpm test:integration -- tests/integration/material-processing.test.ts
pnpm test -- tests/unit/material-processing.test.ts
pnpm typecheck
```

Expected: PASS; each fixture reaches the documented state, no quarantined/blocked/unread material reaches a parser or AI content-ref list, and every parser has CPU/memory/decompression/time limits.

- [ ] **Step 6: Commit**

```bash
git add prisma src/domain/material.ts src/media/security src/media/parsers src/server/services/material-processing-service.ts src/app/api/cases tests/integration/material-processing.test.ts tests/fixtures/materials
git commit -m "feat: quarantine and safely process case materials"
```

**Acceptance Criteria:**

- Nearly all formats can be retained without claiming all formats can be understood.
- MIME/signature mismatch and dangerous containers cannot bypass quarantine by filename or request headers.
- Unsupported clean files remain encrypted and show `saved_unread`; they never influence AI output.
- Only scanned, safely parsed, provenance-linked derivatives are eligible for AI input.

### Task 5C: Add immutable transcripts and both voice modes

**Goal:** 同时交付“语音输入+AI 文字回复”和“实时语音对话”两种模式，并保证音频原件、机器转写、用户修订文本和字幕事件各自版本化、不可覆盖且可追溯。

**Dependencies:** Tasks 4, 5A, and 5B。

**Files:**
- Create: `prisma/migrations/202608310004_add_transcript_versions/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/domain/material.ts`
- Create: `src/domain/voice-session.ts`
- Create: `src/media/transcription/transcriber.ts`
- Create: `src/media/transcription/transcript-service.ts`
- Create: `src/media/realtime/realtime-voice-gateway.ts`
- Create: `src/server/services/voice-input-service.ts`
- Create: `src/app/api/cases/[caseId]/voice-input/route.ts`
- Create: `src/app/api/cases/[caseId]/voice-sessions/route.ts`
- Create: `src/app/api/cases/[caseId]/voice-sessions/[sessionId]/events/route.ts`
- Create: `tests/integration/voice-modes.test.ts`

**Interfaces:**

```ts
export interface TranscriptVersion {
  transcriptVersionId: string;
  sourceAudioVersionId: string;
  parentTranscriptVersionId: string | null;
  kind: "machine_transcript" | "user_revision" | "realtime_caption";
  text: string;
  locale: string;
  segments: Array<{ startMs: number; endMs: number; text: string }>;
  createdAt: string;
}

export interface RealtimeVoiceGateway {
  start(session: VoiceSessionConfig): Promise<VoiceSessionHandle>;
  appendAudio(sessionId: string, chunk: Uint8Array): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  end(sessionId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing versioning and voice-state tests**

```ts
it("creates a user revision without overwriting the machine transcript", async () => {
  const machine = await transcriptService.createMachineTranscript(audioVersion, segments);
  const revision = await transcriptService.revise(machine.transcriptVersionId, "用户修订内容");
  expect(revision.parentTranscriptVersionId).toBe(machine.transcriptVersionId);
  await expect(transcriptRepository.get(machine.transcriptVersionId)).resolves.toEqual(machine);
});

it("interrupts realtime output while preserving synchronized captions", async () => {
  await voiceGateway.interrupt("voice-a");
  expect(await eventRepository.list("voice-a")).toContainEqual(expect.objectContaining({ type: "assistant_interrupted" }));
});
```

覆盖录音取消/重录、发送前编辑、转写失败保留原音频、实时静音/打断/切文字/断线恢复、字幕顺序、跨账户 voice session 拒绝、未经扫描的音频不转写、字幕未确认前不写入正式案件字段。

- [ ] **Step 2: Run voice tests before implementation**

Run: `pnpm test:integration -- tests/integration/voice-modes.test.ts`

Expected: FAIL because transcript versioning, transcription adapter, realtime gateway, and voice routes are missing.

- [ ] **Step 3: Implement voice input plus text response**

Treat recorded audio as a Task 5A material: enforce the same quotas, encrypt immediately, scan it through Task 5B, and only then transcribe. Preserve the original audio object even when transcription fails. The machine transcript is a new immutable version; “发送前编辑” creates a child `user_revision`, while cancel/re-record creates a new audio material version and leaves the cancelled version inaccessible to AI pending deletion cleanup. Only the user-confirmed transcript version becomes an `AiInputEnvelope.contentRef`.

- [ ] **Step 4: Implement realtime voice with synchronized captions and interruption**

Route realtime media through a provider-neutral gateway configured outside the domain layer. Support bidirectional audio, ordered caption events, barge-in/interrupt, mute, explicit end, and switch-to-text without losing the conversation. Persist encrypted source audio only when the user has accepted the recording notice; regardless, persist consent-safe caption/review events needed for the case. Reconnect uses monotonic event sequence numbers and never duplicates a transcript version. Local crisis precheck and PII policy still run before any confirmed transcript enters model orchestration.

- [ ] **Step 5: Run contract, failure, and recovery tests**

Run:

```powershell
pnpm test:integration -- tests/integration/voice-modes.test.ts
pnpm test -- tests/unit/transcript-service.test.ts
pnpm typecheck
```

Expected: PASS; both modes work with deterministic fake transcription/realtime providers, interruptions are observable, reconnect is idempotent, and original audio/transcript/revision rows remain distinct and traceable.

- [ ] **Step 6: Commit**

```bash
git add prisma src/domain/material.ts src/domain/voice-session.ts src/media/transcription src/media/realtime src/server/services/voice-input-service.ts src/app/api/cases tests/integration/voice-modes.test.ts
git commit -m "feat: add versioned voice intake modes"
```

**Acceptance Criteria:**

- Users can record, cancel, re-record, edit a transcript before sending, and receive an AI text response.
- Users can hold a realtime voice conversation with synchronized captions, interruption, mute, reconnect, and text-mode switching.
- Audio originals, machine transcripts, user revisions, and realtime caption versions never overwrite each other.
- Unscanned audio and unconfirmed transcript text never enter AI assessment.

### Task 6: Build the AI conversation UI and user review workspace

**Goal:** 用 ChatGPT 类对话替代表单，并让用户在同一工作台安全上传材料、使用两种语音入口、查看处理状态，以及审阅、修改和确认结构化档案。

**Dependencies:** Tasks 4–5C。

**Files:**
- Create: `src/app/(public)/start/page.tsx`
- Create: `src/app/(private)/cases/[caseId]/page.tsx`
- Create: `src/components/chat/conversation.tsx`
- Create: `src/components/chat/composer.tsx`
- Create: `src/components/chat/material-upload.tsx`
- Create: `src/components/chat/voice-input.tsx`
- Create: `src/components/chat/realtime-voice.tsx`
- Create: `src/components/chat/processing-status.tsx`
- Create: `src/components/case-review/case-review.tsx`
- Create: `src/components/case-review/indicator-matrix.tsx`
- Create: `src/components/case-review/evidence-coverage.tsx`
- Create: `src/components/common/disclaimer.tsx`
- Create: `src/app/api/accounts/route.ts`
- Create: `src/app/api/conversation/route.ts`
- Create: `src/app/api/cases/route.ts`
- Create: `src/app/api/cases/[caseId]/route.ts`
- Create: `tests/e2e/conversation-review.spec.ts`
- Create: `tests/e2e/material-and-voice-intake.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`

**Interfaces:**

```ts
export type CreateAccountResponse = { alias: string; recoverySecret: string };

export type ConversationRequest = { sessionId: string; message: string; contentRefs?: string[] };
export type ConversationResponse = { assistant: AssistantTurn; caseDraft?: CaseDraft };

export type PatchCaseRequest = { patch: CasePatch; expectedVersion: number };
export type PatchCaseResponse = { case: CaseRecord };
export type CreateCaseRequest = { draft: CaseDraft };
export type CreateCaseResponse = { case: CaseRecord };
export type ApiError = {
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "VERSION_CONFLICT" | "DEGRADED";
  message: string;
  requestId: string;
};
```

Routes: `POST /api/accounts` creates the pseudonymous session; `POST /api/conversation` accepts `ConversationRequest`; `POST /api/cases` creates a private draft; `GET/PATCH/DELETE /api/cases/:caseId` always derives `accountId` from the session cookie and never accepts it from request JSON.

- [ ] **Step 1: Write the failing Playwright flow**

```ts
test("user can converse, review indicators, and save privately", async ({ page }) => {
  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("我被扣留护照，无法自由离开工作地点");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("ILO 指标矩阵")).toBeVisible();
  await expect(page.getByText("用户报告，未经独立核实")).toBeVisible();
  await page.getByRole("button", { name: "保存为私密档案" }).click();
  await expect(page.getByText("仅本人可见")).toBeVisible();
});

test("unscanned uploads are visible but cannot be sent to AI", async ({ page }) => {
  await page.goto("/cases/case-a");
  await page.getByLabel("添加材料").setInputFiles("tests/fixtures/materials/sample.pdf");
  await expect(page.getByText("正在安全扫描")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the E2E test before UI implementation**

Run: `pnpm test:e2e tests/e2e/conversation-review.spec.ts tests/e2e/material-and-voice-intake.spec.ts`
Expected: FAIL because routes and components are missing.

- [ ] **Step 3: Implement the conversation page**

Build the start page as a server component containing a client `Conversation` island. The first text-only model call may run with an ephemeral server-side session and must not persist the message. Before any material or audio upload, create/restore the pseudonymous account and private draft because quota, encryption, ownership, deletion, and audit controls require a case boundary. Show the one-time recovery secret in a copy/download panel and require acknowledgement. The page shows platform identity, privacy limitations, crisis exit, pause/skip controls, streaming status, stop/retry/regenerate, edit-and-resend, a 10,000-character composer, drag/drop and file picker, upload progress, scan/parse/quarantine state, and both voice modes. Every substantive assessment response renders the fixed `ai-assessment`, `legal-reference`, and `user-decision` disclaimers.

The composer may attach only server-issued `contentRefs` from Task 5B/5C. `quarantined`, `scanning`, `scan_failed`, `blocked_malicious`, and `saved_unread` materials remain visible in the case but are disabled for AI use with plain-language status. Do not send local filesystem paths, raw bytes, object keys, unconfirmed transcripts, or browser-declared MIME values to the AI route. Upload/voice errors must not erase typed text or previously completed uploads.

- [ ] **Step 4: Implement review components**

Render facts with source quotes and message IDs; all 11 indicators in canonical ILO order including `not_hit` and `insufficient`; the three elements; qualitative evidence coverage; legal-navigation source/date/stale status; referral choices; and safety flags. Each editable field has “确认 / 修改 / 删除 / 标记不确定” controls. Use text plus icons—not status colors alone. Do not render progress/score bars, rankings, “verified company” labels, public visibility controls, or phrases that imply authority submission.

- [ ] **Step 5: Implement optimistic-concurrency PATCH**

Parse bodies with strict Zod schemas, cap request size at 64 KiB, require `expectedVersion`, and return HTTP 409 with `ApiError.code="VERSION_CONFLICT"` when a stale review attempts to overwrite a newer version. Return only the canonical server record after a successful patch. HTTP mapping is fixed: 400 invalid input, 401 missing/expired session, 404 wrong owner or absent/deleted case (same response to avoid enumeration), 409 version conflict, 503 safe degraded mode.

- [ ] **Step 6: Run E2E and accessibility checks**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
$env:AI_PROVIDER = "mock"
$env:SESSION_SECRET = "0123456789abcdef0123456789abcdef"
pnpm exec prisma migrate deploy
pnpm test:e2e tests/e2e/conversation-review.spec.ts tests/e2e/material-and-voice-intake.spec.ts
pnpm axe:e2e
pnpm db:test:down
Remove-Item Env:DATABASE_URL, Env:AI_PROVIDER, Env:SESSION_SECRET
```

Expected: PASS; Axe reports zero serious/critical violations; keyboard navigation, focus restoration after errors, labels, live-region status, and crisis exit are usable.

- [ ] **Step 7: Commit**

```bash
git add src/app src/components tests/e2e/conversation-review.spec.ts tests/e2e/accessibility.spec.ts playwright.config.ts
git commit -m "feat: add AI conversation and private case review"
```

**Acceptance Criteria:**

- A user can start with natural language, see AI-extracted facts and indicators, correct them, and save a private case.
- A user can safely upload materials, see upload/scan/parse/quarantine states, and use either voice mode from the same ChatGPT-like composer.
- Materials and transcript versions are offered to AI only after server-side scanning/parsing and explicit user confirmation.
- All indicators and evidence gaps are visible; no score or legal conclusion is shown.
- Crisis mode stops normal questions and provides a safe exit.
- UI never claims a report was sent to an authority.

### Task 6A: Add administrator RBAC, independent review labels, and user-visible access history

**Goal:** 提供默认低频但可随时使用的管理员审核工作台；管理员无需填写查看理由即可复核案件和材料，但不能绕过 RBAC，且所有敏感操作自动审计并向用户展示访问记录。

**Dependencies:** Tasks 5C and 6。

**Files:**
- Create: `prisma/migrations/202608310005_add_admin_review/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `src/domain/admin-review.ts`
- Create: `src/server/admin/rbac.ts`
- Create: `src/server/admin/admin-case-service.ts`
- Create: `src/server/repositories/admin-review-repository.ts`
- Modify: `src/server/audit.ts`
- Create: `src/app/(admin)/admin/cases/page.tsx`
- Create: `src/app/(admin)/admin/cases/[caseId]/page.tsx`
- Create: `src/app/api/admin/cases/route.ts`
- Create: `src/app/api/admin/cases/[caseId]/route.ts`
- Create: `src/app/api/admin/cases/[caseId]/materials/[materialId]/download/route.ts`
- Create: `src/app/api/admin/cases/[caseId]/reviews/route.ts`
- Create: `src/app/api/cases/[caseId]/access-history/route.ts`
- Create: `src/components/admin/admin-case-review.tsx`
- Create: `src/components/case-review/access-history.tsx`
- Create: `tests/integration/admin-review.test.ts`
- Create: `tests/e2e/admin-review.spec.ts`

**Interfaces:**

```ts
export type AdminRole = "case_reviewer" | "case_supervisor";
export type AdminReviewStatus =
  | "intake_rejected"
  | "evidence_incomplete"
  | "credibility_concern"
  | "demonstrably_false";

export interface AdminReviewVersion {
  adminReviewVersionId: string;
  caseId: string;
  reviewerId: string;
  status: AdminReviewStatus;
  rationale: string | null;
  sourceRefs: string[];
  supersedesId: string | null;
  secondReviewerId: string | null;
  createdAt: string;
}

export type AdminAuditAction =
  | "admin_case_view"
  | "admin_material_play"
  | "admin_material_download"
  | "admin_review_create"
  | "admin_review_update"
  | "admin_case_modify"
  | "admin_case_delete";
```

- [ ] **Step 1: Write failing authorization, review-separation, and audit tests**

```ts
it("allows an authorized reviewer to view without a reason and records the access", async () => {
  await adminCaseService.getCase({ adminId: "reviewer-a", caseId: "case-a" });
  expect(await auditRepository.findForCase("case-a")).toContainEqual(
    expect.objectContaining({ action: "admin_case_view", actorId: "reviewer-a" }),
  );
});

it("requires two distinct reviewers for demonstrably_false", async () => {
  await expect(createAdminReview({ status: "demonstrably_false", reviewerId: "reviewer-a", secondReviewerId: "reviewer-a" }))
    .rejects.toThrow("SECOND_REVIEWER_REQUIRED");
});
```

覆盖未登录/普通用户/错误角色拒绝、直接猜测 material ID 不可下载、列表与详情均受 RBAC、播放/下载/标注/修改/删除自动审计、管理员意见不覆盖用户陈述或 AI ReviewVersion、四类状态枚举、`demonstrably_false` 反证来源和二次复核、用户只能查看自己案件的访问历史。

- [ ] **Step 2: Run admin tests before implementation**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
pnpm test:integration -- tests/integration/admin-review.test.ts
pnpm db:test:down
Remove-Item Env:DATABASE_URL
```

Expected: FAIL because admin identity, RBAC, review versions, admin routes, and audit actions do not exist.

- [ ] **Step 3: Implement server-enforced RBAC and unrestricted-in-time review access**

Authenticate administrators separately from pseudonymous users, store only stable internal actor IDs in audits, and authorize every list/detail/play/download/review/modify/delete request in the service layer. `case_reviewer` may list, view, play/download and create ordinary review versions; `case_supervisor` is additionally required for destructive changes and second review. Access is available at any time and no reason prompt is required, but there is no anonymous/shared admin credential, URL-only authorization, bypass endpoint, or public object-store URL. Default-low-frequency is an operational expectation, not a weaker permission or audit rule.

- [ ] **Step 4: Implement independent review versions and user recourse**

Persist admin review versions separately from `CaseRecord`, user statements, material versions, transcripts, and AI review versions. `intake_rejected` covers duplicate/spam/test/out-of-scope/user-withdrawn intake; `evidence_incomplete` never means false; `credibility_concern` requires a documented inconsistency/source reference; `demonstrably_false` requires reproducible counter-evidence and a distinct supervisor's second review. New reviews supersede but never overwrite prior versions. Notify the user of review status, allow continued material submission, and expose an appeal/reconsideration link; Task 9 owns the full appeal lifecycle and deletion/retention effects.

- [ ] **Step 5: Implement automatic audit and user-visible access history**

Write an audit event before returning sensitive case content or issuing a short-lived material playback/download grant. Record actor ID, case/material ID, action, UTC timestamp, outcome, and request correlation hash—never the material contents, narrative, IP/device identifier, or credentials. Viewing requires no reason field. Expose a paginated owner-only access-history endpoint and UI listing access/play/download/label/modify/delete time and action in plain language. Audit write failure is fail-closed for reads/downloads/changes, except a documented emergency static-resource path that never accesses a case.

- [ ] **Step 6: Run integration, E2E, and policy checks**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
pnpm exec prisma migrate deploy
pnpm test:integration -- tests/integration/admin-review.test.ts
pnpm test:e2e tests/e2e/admin-review.spec.ts
pnpm typecheck
pnpm db:test:down
Remove-Item Env:DATABASE_URL
```

Expected: PASS; unauthorized requests receive enumeration-safe 404/403 responses, every successful sensitive action has an audit event, users see only their own access history, review versions remain independent, and `demonstrably_false` cannot be created by one reviewer.

- [ ] **Step 7: Commit**

```bash
git add prisma src/domain/admin-review.ts src/server/admin src/server/repositories/admin-review-repository.ts src/server/audit.ts src/app/\(admin\) src/app/api/admin src/app/api/cases src/components/admin src/components/case-review/access-history.tsx tests/integration/admin-review.test.ts tests/e2e/admin-review.spec.ts
git commit -m "feat: add audited administrator case review"
```

**Acceptance Criteria:**

- Authorized administrators can review cases and original materials at any time without selecting or entering a view reason.
- RBAC is enforced server-side for list, view, play, download, label, modify, and delete operations.
- Admin review labels use exactly the four approved statuses, remain independent, retain history, and support notification, supplementation, and appeal.
- Every sensitive admin action is automatically audited; users can inspect access history for their own cases.

### Task 7: Implement qualitative evidence coverage and legal/channel navigation

**Goal:** 将“证据是否覆盖常见提交要素”和“可能相关法律/渠道”实现为可追溯定性输出。

**Dependencies:** Tasks 2–4, 5B, 5C, and 6A.

**Files:**
- Create: `src/domain/evidence-coverage.ts`
- Create: `src/server/evidence-coverage.ts`
- Create: `src/server/legal-navigation.ts`
- Create: `src/server/referrals.ts`
- Create: `src/app/api/assessment/route.ts`
- Create: `tests/unit/evidence-coverage.test.ts`
- Create: `tests/integration/legal-navigation.test.ts`
- Create: `tests/fixtures/assessment.ts`

**Interfaces:**

```ts
export function assessEvidenceCoverage(input: CaseDraft): EvidenceCoverageItem[];
export function buildLegalNavigation(input: JurisdictionContext, hits: KnowledgeHit[]): LegalNavigationItem[];
export function buildReferralOptions(input: JurisdictionContext, safety: SafetyFlag[]): ReferralOption[];

export type AssessmentRequest = { draft: CaseDraft };
export type AssessmentResponse = {
  evidenceCoverage: EvidenceCoverageItem[];
  legalNavigation: LegalNavigationItem[];
  referrals: ReferralOption[];
  notices: string[];
};
```

- [ ] **Step 1: Write qualitative coverage tests**

```ts
it("reports a gap without converting it into a score", () => {
  const coverage = assessEvidenceCoverage(makeNarrativeOnlyDraft());
  expect(coverage.find((item) => item.topic === "timeline")?.status).toBe("gap");
  expect(JSON.stringify(coverage)).not.toMatch(/score|probability|percent|rating/i);
});
```

- [ ] **Step 2: Run tests before implementation**

Run: `pnpm test -- tests/unit/evidence-coverage.test.ts`
Expected: FAIL because the evidence-coverage service is missing. After the database harness exists, run `pnpm db:test:up; pnpm test:integration -- tests/integration/legal-navigation.test.ts; pnpm db:test:down`; Expected: FAIL because legal navigation is missing.

- [ ] **Step 3: Implement coverage rules**

Implement a deterministic rule table for the seven `EvidenceCoverageItem.topic` values defined in Task 2. `covered` requires at least one user-confirmed fact plus its source message; `partial` means the topic exists but time/entity/source linkage is incomplete; `gap` means no user-confirmed fact exists. Every item includes plain-language `explanation`, exact `sourceMessageIds`, and safe options chosen from version-controlled copy. The rule table never consumes `iloIndicators` as a shortcut and never infers that coverage equals legal sufficiency.

- [ ] **Step 4: Implement legal navigation**

For each candidate, require that the law's jurisdiction matches the relevant confirmed dimension: employment/criminal law uses `incidentCountry`; user-protection resources use `userCountry`; import-control law uses `productDestination`. Drop `design` sources. Map non-stale `verified` to `possible`; map `needs-review` or stale sources to `needs_review`; return `not_covered` only with a registry source explaining scope. Attach source ID, premise, verification date, stale flag, and official URL. For `needs_review`, fixed copy is “可能相关，需核实”，never a paraphrased legal conclusion.

- [ ] **Step 5: Implement referral routing**

Read referral candidates only from source-registry channel entries, filter by confirmed jurisdiction and freshness, and return at most three stable-sorted options with anonymity, feedback expectations, official URL, source ID, and user-controlled steps. If no reliable candidate exists, return `[]` plus the static “需人工核实渠道” explanation in the API layer. Any crisis flag suppresses ordinary comparisons and returns only region-appropriate safety resources; an unconfirmed location asks for country/region or shows global emergency guidance without geolocation inference.

- [ ] **Step 6: Run tests**

Run: `pnpm test -- tests/unit/evidence-coverage.test.ts; pnpm db:test:up; pnpm test:integration -- tests/integration/legal-navigation.test.ts; pnpm db:test:down`
Expected: both suites PASS; no numeric score or unsupported legal claim is present; test database is removed.

- [ ] **Step 7: Commit**

```bash
git add src/domain/evidence-coverage.ts src/server/evidence-coverage.ts src/server/legal-navigation.ts src/server/referrals.ts src/app/api/assessment tests/unit/evidence-coverage.test.ts tests/integration/legal-navigation.test.ts tests/fixtures/assessment.ts
git commit -m "feat: add qualitative evidence and legal navigation"
```

**Acceptance Criteria:**

- Evidence output only describes coverage and gaps, never legal sufficiency or a score.
- Specific law references require confirmed jurisdiction context and traceable source metadata.
- Crisis referral always takes precedence over ordinary channel suggestions.

### Task 8: Add export connectors and user-confirmed handoff

**Goal:** 让用户将私密档案转换为通用材料，并为未来 CBP/BAFA 等适配器保留稳定接口。

**Dependencies:** Tasks 2, 5A–5C, 6A, and 7.

**Files:**
- Create: `src/connectors/connector.ts`
- Create: `src/connectors/export/markdown.ts`
- Create: `src/connectors/export/json.ts`
- Create: `src/connectors/registry.ts`
- Create: `src/app/api/cases/[caseId]/export/route.ts`
- Create: `tests/unit/export-connectors.test.ts`
- Create: `tests/fixtures/connectors.ts`

**Interfaces:**

```ts
export interface Connector {
  describe(): ConnectorDescription;
  validate(record: CaseRecord, confirmation: UserConfirmation): ValidationIssue[];
  preview(record: CaseRecord, confirmation: UserConfirmation): Promise<ExportPreview>;
}

export interface ConnectorDescription {
  connectorId: "markdown" | "json" | "manual";
  targetName: string;
  jurisdiction: string;
  supportedFieldPaths: string[];
  attachmentPolicy: "none";
  lastVerified: string;
}

export interface ValidationIssue {
  fieldPath: string;
  code: "missing" | "unconfirmed" | "unsupported";
  message: string;
}

export interface UserConfirmation {
  confirmed: true;
  caseId: string;
  caseVersion: number;
  connectorId: ConnectorDescription["connectorId"];
  fieldPaths: string[];
  consentEventId: string;
}

export interface ExportPreview {
  exportId: string;
  connectorId: ConnectorDescription["connectorId"];
  caseVersion: number;
  fieldPaths: string[];
  mediaType: "text/markdown" | "application/json";
  text: string;
  disclaimerIds: string[];
  expiresAt: string;
}

export type SubmissionStatus = "unknown" | "received" | "processing" | "closed";
export interface ExternalSubmissionConnector extends Connector {
  submit(record: CaseRecord, confirmation: UserConfirmation, exportId: string): Promise<SubmitResult>;
  status(referenceId: string): Promise<SubmissionStatus>;
}

export type SubmitResult =
  | { kind: "manual_handoff"; officialUrl: string; exportId: string }
  | { kind: "received"; referenceId: string; receivedAt: string };
```

- [ ] **Step 1: Write export and consent tests**

```ts
it("exports only user-confirmed fields", async () => {
  const preview = await markdownConnector.preview(makePrivateCaseRecord(), makeNarrativeConfirmation());
  expect(preview.text).toContain("用户报告（未经独立核实）");
  expect(preview.text).not.toContain("password");
});

it("never reports received without a target reference", async () => {
  const record = makePrivateCaseRecord();
  const confirmation = makeManualConfirmation();
  const preview = await manualConnector.preview(record, confirmation);
  const result = await manualConnector.submit(record, confirmation, preview.exportId);
  expect(result.kind).toBe("manual_handoff");
});
```

- [ ] **Step 2: Run tests before implementation**

Run: `pnpm test -- tests/unit/export-connectors.test.ts`
Expected: FAIL because connectors are missing.

- [ ] **Step 3: Implement Markdown and JSON exporters**

Resolve each requested JSON Pointer-style `fieldPath` against an allowlist, require it to appear in both `UserConfirmation.fieldPaths` and the case consent snapshot, and reject wildcard/root selection. Include only confirmed facts, timeline, ILO matrix, evidence coverage, legal navigation, source dates, safety flags, consent version, and fixed disclaimers. Exclude credentials, account/session IDs, internal audit metadata, raw message text, files, and unconfirmed fields. Serialize JSON with stable key order and Markdown with explicit “用户报告（未经独立核实）”.

- [ ] **Step 4: Implement connector validation and manual handoff**

`preview()` creates and persists a 15-minute preview record with an `exportId` bound to `caseId`, `caseVersion`, connector, fields, and consent event; preview rendering is deterministic, but ID creation uses the injected clock/ID generator. Markdown/JSON implement only `Connector` and create a local download. A `ManualHandoffConnector` implements `ExternalSubmissionConnector`: `submit()` also receives the `exportId`, rejects missing/expired/mismatched confirmation, refuses if the case version changed after preview, and returns `manual_handoff` with the verified official URL; `status()` returns `unknown`. Do not add browser automation or automatic submission in MVP; the `received` union branch remains unreachable until a separately approved connector can verify an external reference ID.

- [ ] **Step 5: Run tests and update lifecycle**

Run: `pnpm test -- tests/unit/export-connectors.test.ts`
Expected: PASS; export changes lifecycle to `exported` only after a successful local export, not after an unverified external submission.

- [ ] **Step 6: Commit**

```bash
git add src/connectors src/app/api/cases tests/unit/export-connectors.test.ts tests/fixtures/connectors.ts
git commit -m "feat: add user-controlled case export connectors"
```

**Acceptance Criteria:**

- Users can preview and export a private case without sending it anywhere.
- Each connector declares fields, source, and handoff behavior.
- No connector claims “received” without a verifiable reference ID.
- No automatic external submission exists in MVP.

### Task 9: Implement privacy, deletion, audit, and model-failure controls

**Goal:** 把安全承诺落实为默认设置、数据生命周期和可演练的故障行为。

**Dependencies:** Tasks 4–8, 5A–5C, and 6A。

**Files:**
- Create: `src/server/redaction.ts`
- Create: `src/server/audit.ts`
- Create: `src/server/retention.ts`
- Create: `src/server/key-rotation.ts`
- Create: `src/server/repositories/appeal-repository.ts`
- Create: `src/app/api/cases/[caseId]/delete/route.ts`
- Create: `src/app/api/cases/[caseId]/appeals/route.ts`
- Create: `tests/integration/privacy-controls.test.ts`
- Modify: `docs/risk-register.md`
- Modify: `docs/release-gates.md`

**Interfaces:**

```ts
export function detectPotentialPersonalData(text: string): PersonalDataHint[];
export function deleteCase(accountId: string, caseId: string): Promise<DeletionReceipt>;
export function recordAudit(event: AuditEvent): Promise<void>;

export interface PersonalDataHint {
  hintId: string;
  kind: "phone" | "email" | "identity_document" | "precise_address";
  spanStart: number;
  spanEnd: number;
  maskedPreview: string;
}

export interface DeletionReceipt {
  receiptId: string;
  caseId: string;
  deletedAt: string;
  targets: Array<
    | "primary_record"
    | "conversation_messages"
    | "material_metadata"
    | "object_store"
    | "transcript_versions"
    | "wrapped_keys"
    | "search_index"
    | "cache"
    | "backup_queue"
  >;
  externalSystems: "not_applicable";
}

export interface AppealRecord {
  appealId: string;
  caseId: string;
  accountId: string;
  adminReviewVersionId: string;
  statement: string;
  supportingMaterialIds: string[];
  status: "submitted" | "under_review" | "resolved";
  createdAt: string;
}

export interface AuditEvent {
  eventId: string;
  accountId: string;
  caseId?: string;
  actorId?: string;
  materialId?: string;
  action:
    | "create"
    | "update"
    | "export_preview"
    | "export"
    | "delete"
    | "consent_change"
    | "model_fallback"
    | "material_view"
    | "material_play"
    | "material_download"
    | "admin_case_view"
    | "admin_material_play"
    | "admin_material_download"
    | "admin_review_create"
    | "admin_review_update"
    | "admin_case_modify"
    | "admin_case_delete";
  occurredAt: string;
  outcome?: "allowed" | "denied" | "failed";
  metadata: { connectorId?: string; fieldCount?: number; reasonCode?: string; reviewStatus?: string };
}
```

- [ ] **Step 1: Write privacy control tests**

```ts
it("deletion queues encrypted objects, transcripts, wrapped keys, and backups", async () => {
  const receipt = await deleteCase("acct-a", "case-a");
  expect(receipt.targets).toEqual(expect.arrayContaining([
    "object_store", "transcript_versions", "wrapped_keys", "backup_queue",
  ]));
});

it("deletion receipt lists primary and queued cleanup targets", async () => {
  const receipt = await deleteCase("acct-a", "case-a");
  expect(receipt.targets).toEqual(expect.arrayContaining(["primary_record", "search_index", "backup_queue"]));
});
```

- [ ] **Step 2: Run tests before implementation**

Run: `pnpm db:test:up; pnpm test:integration -- tests/integration/privacy-controls.test.ts`
Expected: FAIL because privacy services and delete route are missing; then run `pnpm db:test:down`.

- [ ] **Step 3: Implement PII hints and explicit user confirmation**

Detect likely phone, email, identity-document, and precise-address patterns with locale-aware regexes that return only `PersonalDataHint` spans and masked previews. Show a confirmation prompt with “保留原文 / 使用脱敏版本 / 删除该片段”; do not silently rewrite the user’s narrative. Store only the user-confirmed version and retain the hint decision in the consent event, never the discarded raw span.

- [ ] **Step 4: Implement deletion and retention jobs**

`deleteCase()` runs a transaction that marks the case deleted, revokes active upload/playback/download grants, and appends idempotent `CleanupJob` rows for material metadata, encrypted object versions, transcript versions, wrapped data keys, search index, cache, and backup queue; it returns a signed `DeletionReceipt`. All user/admin repository reads exclude deleted records immediately and cleanup workers are safe to retry. Object deletion and wrapped-key destruction are separately verified; backup tombstones prevent deleted data from being restored into active storage. The receipt explicitly says external systems are not applicable until a connector has separately shared data; never claim deletion from systems outside platform control.

Implement KEK/KMS key-version rotation as a resumable re-wrap job: decrypt data keys only inside the key service, write the new wrapped-key version, verify a sample decrypt/hash, then retire the old version after a documented rollback window. Rotation never rewrites plaintext objects and failures retain the last readable wrapped-key version. Add quarterly restore-and-delete drills covering primary DB, object store, replicas, caches, search indexes, and backups.

- [ ] **Step 5: Implement audit and degraded-mode logging**

Audit user and administrator create/update/export-preview/export/delete, consent changes, material view/play/download, admin labels, admin modifications, and model fallback with the `AuditEvent` shape, without IP/device identifiers, credentials, raw narrative, source quotes, or full field values. Hash request IDs with a per-deployment salt only for correlation. When AI or knowledge retrieval fails, expose `degraded: true`, a machine-readable `reasonCode`, and static crisis/legal resources; never present partial model output as saved or submitted. Audit failure is fail-closed for sensitive material/admin operations.

The owner-only appeal endpoint binds an appeal to an existing `AdminReviewVersion`, accepts a user statement and already-owned supporting material IDs, and never mutates that review version. Submission creates a new audit event, notifies the review queue, and leaves the case open for further materials and AI review versions. Resolution is a new admin review/appeal event, never an overwrite.

- [ ] **Step 6: Run tests and security checks**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
pnpm exec prisma migrate deploy
pnpm test:integration -- tests/integration/privacy-controls.test.ts
pnpm audit --audit-level=high
pnpm db:test:down
Remove-Item Env:DATABASE_URL
```

Expected: PASS; deletion receipt names all database/object/transcript/key/cache/backup targets, deleted reads and material grants remain unavailable after retries, key re-wrap preserves verified decryptability, appeal history is append-only, and `pnpm audit` reports no high-severity issue. Any exception must be recorded with owner, expiry date, and mitigation in `docs/risk-register.md` before release.

- [ ] **Step 7: Commit**

```bash
git add src/server src/app/api/cases docs/risk-register.md docs/release-gates.md tests/integration/privacy-controls.test.ts
git commit -m "feat: enforce privacy and failure controls"
```

**Acceptance Criteria:**

- Raw files are encrypted before persistence; dangerous files are quarantined and never executed or parsed. Release is blocked by any unencrypted, unscanned, unauthorized, or publicly exposed raw-material path.
- Deletion has a verifiable receipt and asynchronous cleanup path.
- Backup cleanup, wrapped-key destruction, restore behavior, and key rotation have repeatable drills and evidence.
- Audit records contain actions and timestamps but no raw sensitive content or device identifiers.
- Users can appeal an admin review without overwriting the review, case, materials, or AI history.
- AI/knowledge failures degrade safely without false status claims.

### Task 10: End-to-end quality, release gates, and operational readiness

**Goal:** 证明 MVP 在安全、可及性、来源可追溯和用户控制方面达到 Gate 1。

**Dependencies:** Tasks 1–9。

**Files:**
- Create: `tests/e2e/crisis-flow.spec.ts`
- Create: `tests/e2e/export-flow.spec.ts`
- Create: `tests/e2e/delete-flow.spec.ts`
- Create: `tests/fixtures/golden-cases/*.json`
- Create: `tests/e2e/policy-copy.spec.ts`
- Create: `docs/operations-runbook.md`
- Create: `docs/security/threat-model.md`
- Create: `docs/privacy/dpia-screening.md`
- Create: `docs/testing/red-team-report.md`
- Modify: `README.md`
- Modify: `docs/release-gates.md`
- Modify: `docs/research-and-plan.md`

- [ ] **Step 1: Write release-blocking E2E tests**

Cover these exact scenarios with stable `data-testid` hooks and independent fixtures:

1. Crisis message stops normal questions and displays emergency-resource guidance.
2. Missing jurisdiction prevents specific legal citation.
3. `needs-review` source is shown with a freshness warning.
4. User edits an indicator and saves a private record.
5. Export requires preview and confirmation.
6. Delete removes the record from subsequent reads.
7. No page contains a score, probability, ranking, “blacklist”, “verified company”, or “submitted to authority” claim.
8. A gateway request is blocked when `ModelInputPolicy` returns `confirmation_required`.
9. A static-mode deployment neither calls the model nor writes a case.
10. A material upload enforces 100 MB/2 GB atomic quotas; unsupported clean files remain `saved_unread`; quarantined/blocked material never reaches AI.
11. Both voice modes preserve immutable audio/transcript/revision versions; interruption and reconnect are recoverable.
12. Admin review actions require RBAC, create independent four-state versions, and are visible in owner access history.
13. Golden cases cover simplified Chinese, English, one additional pilot locale, mixed-language input, information-insufficient input, and prompt-injection attempts; unsupported locales disclose the fallback language instead of silently mistranslating.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
pnpm db:test:up
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public"
$env:AI_PROVIDER = "mock"
$env:SESSION_SECRET = "0123456789abcdef0123456789abcdef"
pnpm exec prisma migrate deploy
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm axe:e2e
pnpm db:test:down
Remove-Item Env:DATABASE_URL, Env:AI_PROVIDER, Env:SESSION_SECRET
```

Expected: PASS with zero release-blocking failures and the isolated test database removed.

- [ ] **Step 3: Run static policy audits**

Run:

```powershell
rg -n -i "score|probability|rank|rating|successRate|blacklist|verified company|已提交|构成强迫劳动|已经违法|举报成功率|足以证明违法" src tests
```

Expected: matches are confined to `tests/e2e/policy-copy.spec.ts`, schema negative tests, and the static policy-audit command itself; no user-facing production copy, prompt, serialized API field, or connector output may match. If a safety disclaimer needs a prohibited term to explain what the app does not do, isolate it in an allowlisted file and assert it never appears in assessment output.

- [ ] **Step 4: Complete Gate 0/1 evidence**

Record golden-case results, source-index output, dependency audit, accessibility report, deletion drill, crisis drill, model-input confirmation drill, and model-fallback drill in `docs/operations-runbook.md`. `docs/security/threat-model.md` covers trust boundaries, assets, attackers, misuse cases, gateway/DB/backup flows, mitigations, and residual risks; `docs/privacy/dpia-screening.md` records lawful-basis questions, special-category data, processor/region/retention decisions, data-subject controls, and whether a full DPIA is required; `docs/testing/red-team-report.md` records multilingual crisis misses, prompt injection, source fabrication, legal-overclaiming, and unsafe evidence-gathering attempts. Each evidence item records commit SHA, command, UTC timestamp, artifact path, pass/fail, and reviewer. Mark Gate 1 only when every checklist item in `docs/release-gates.md` has a named reviewer and evidence link.

- [ ] **Step 5: Update project documentation**

README must state the AI-Native MVP boundary and list exactly what is not shipped. Research plan must point to the implementation plan and retain “no legal advice” language. Release gates must block any unencrypted, unscanned, unauthorized, or publicly exposed raw-material path, plus public pages, event clustering, and automatic submission.

- [ ] **Step 6: Commit the release evidence**

```bash
git add tests/e2e tests/fixtures/golden-cases docs/operations-runbook.md docs/security/threat-model.md docs/privacy/dpia-screening.md docs/testing/red-team-report.md README.md docs/release-gates.md docs/research-and-plan.md
git commit -m "test: establish MVP release evidence"
```

**Acceptance Criteria:**

- Gate 1 passes only with all release-blocking tests and evidence present.
- The application remains private-by-default and non-scoring.
- The app can be disabled or degraded to static crisis/legal resources without claiming work was saved or submitted.
- No unreviewed external connector, public report page, raw evidence path, ranking, or B2B endpoint is reachable in production configuration; raw-material storage is reachable only through encrypted, scanned, RBAC-protected and audited routes.

## Dependency and Milestone Summary

| Milestone | Tasks | Exit condition |
|-----------|-------|----------------|
| M0 基线 | 1–2 | App runs; domain schema rejects scoring fields |
| M1 可追溯 AI | 3–4 | Knowledge sources are traceable; crisis-first orchestration passes golden tests |
| M2 私密档案与材料 | 5–5B | User can save encrypted materials; quotas, scanning and unread states are enforced |
| M3 语音与工作台 | 5C–6 | Both voice modes, ChatGPT-like review and safe material attachment work |
| M4 审核与渠道 | 6A–8 | RBAC review, independent labels/appeals and user-confirmed export work |
| M5 安全发布 | 9–10 | Privacy drills, deletion/backup/key rotation, E2E/accessibility/red-team evidence complete |

## Explicit Non-Deliverables

本计划不交付：公司公开页面、地图、报告数量排名、默认跨用户事件聚类、自动向 CBP/BAFA/劳动监察机构提交、法律认定、营救或任何真实用户数据迁移。方案 A 首发交付原始材料加密托管、双模式语音和管理员审核；它们只有在媒体隔离/扫描、加密、RBAC、访问审计、删除/备份演练和密钥门禁全部通过后才能启用。跨案件聚合仍是后置能力，必须逐用户明确加入并保留内部来源链。
