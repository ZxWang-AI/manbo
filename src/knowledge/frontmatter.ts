import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { z } from "zod";

export type KnowledgeEvidenceStatus = "verified" | "design" | "needs-review";
export type KnowledgeSourceKind = "url" | "path" | "citation";

export interface KnowledgeSourceReference {
  raw: string;
  kind: KnowledgeSourceKind;
  /** Present for HTTPS sources after URL normalization. */
  url?: string;
  /** Repository-relative path for local references. */
  repositoryPath?: string;
}

export interface KnowledgeDocument {
  sourceId: string;
  title: string;
  jurisdiction: string;
  evidenceStatus: KnowledgeEvidenceStatus;
  lastVerified: string;
  excerpt: string;
  authority: string;
  sourceUrls: string[];
  sourceReferences: KnowledgeSourceReference[];
  /** Optional metadata used to distinguish legal/channel material at retrieval time. */
  category?: string;
}

const dateSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.iso.date(),
);

const frontmatterSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    jurisdiction: z.string().trim().min(1),
    authority: z.string().trim().min(1),
    last_verified: dateSchema,
    evidence_status: z.enum(["verified", "design", "needs-review"]),
    sources: z.array(z.unknown()).min(1),
    category: z.string().trim().min(1).optional(),
    audience: z.unknown().optional(),
    maintainer: z.unknown().optional(),
    in_force: z.unknown().optional(),
    applies_from: z.unknown().optional(),
    signed: z.unknown().optional(),
  })
  .strict();

function normalizePathSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

interface KnowledgePathContext {
  absolutePath: string;
  knowledgeRoot: string;
  repositoryRoot: string;
}

/**
 * Resolve a document path while enforcing the Markdown-only knowledge-base trust boundary.
 * The parser intentionally accepts a not-yet-created logical path for unit fixtures,
 * but still validates its location and extension.
 */
function resolveKnowledgePath(filePath: string): KnowledgePathContext {
  if (!filePath || filePath.includes("\0")) {
    throw new Error("Knowledge document path is empty or contains a NUL byte");
  }

  const normalizedInput = normalizePathSeparators(filePath);
  if (!path.isAbsolute(filePath) && normalizedInput.split("/").includes("..")) {
    throw new Error(`Unsafe knowledge document path: ${filePath}`);
  }

  const absolutePath = path.resolve(filePath);
  let knowledgeRoot: string | undefined;
  let cursor = path.dirname(absolutePath);
  while (true) {
    if (path.basename(cursor).toLowerCase() === "knowledge-base") {
      knowledgeRoot = cursor;
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!knowledgeRoot) {
    throw new Error(`Knowledge document must be under knowledge-base/**/*.md: ${filePath}`);
  }

  if (path.extname(absolutePath).toLowerCase() !== ".md") {
    throw new Error(`Knowledge document must be Markdown: ${filePath}`);
  }

  const repositoryRoot = path.dirname(knowledgeRoot);
  const relativeToKnowledge = path.relative(knowledgeRoot, absolutePath);
  if (
    relativeToKnowledge.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToKnowledge) ||
    relativeToKnowledge.length === 0
  ) {
    throw new Error(`Unsafe knowledge document path: ${filePath}`);
  }

  return { absolutePath, knowledgeRoot, repositoryRoot };
}

function normalizeDate(value: string): string {
  // z.iso.date() validates calendar dates and the required YYYY-MM-DD shape.
  return value;
}

function normalizeHttpsUrl(value: string): string | undefined {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Malformed source URL: ${value}`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) {
    throw new Error(`Source URLs must use HTTPS: ${value}`);
  }
  // URL#toString() gives a stable normalized representation while preserving paths.
  return parsed.toString();
}

function resolveLocalReference(
  rawReference: string,
  context: KnowledgePathContext,
): KnowledgeSourceReference {
  if (path.isAbsolute(rawReference) || /^[a-zA-Z]:[\\/]/.test(rawReference)) {
    throw new Error(`Absolute source paths are not allowed: ${rawReference}`);
  }
  if (rawReference.includes("\0")) {
    throw new Error(`Unsafe source path: ${rawReference}`);
  }

  const normalized = normalizePathSeparators(rawReference).replace(/^\.\//, "");
  const candidates = normalized.startsWith("knowledge-base/")
    ? [path.resolve(context.repositoryRoot, normalized)]
    : [
        path.resolve(path.dirname(context.absolutePath), rawReference),
        path.resolve(context.knowledgeRoot, rawReference),
      ];
  const candidate = candidates.find(
    (candidatePath) => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile(),
  );
  if (!candidate) {
    throw new Error(`Source path does not exist: ${rawReference}`);
  }
  const relativeToRepository = path.relative(context.repositoryRoot, candidate);
  if (
    relativeToRepository.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRepository) ||
    relativeToRepository.length === 0
  ) {
    throw new Error(`Source path escapes repository root: ${rawReference}`);
  }
  return {
    raw: rawReference,
    kind: "path",
    repositoryPath: normalizePathSeparators(relativeToRepository),
  };
}

function serializeYamlCitation(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${key}: ${String(nestedValue)}`)
      .join(", ")
      .trim();
  }
  throw new Error("Knowledge source references must be citation strings");
}

function classifySource(value: unknown, context: KnowledgePathContext): KnowledgeSourceReference {
  const raw = serializeYamlCitation(value);
  if (!raw) {
    throw new Error("Knowledge source references cannot be empty");
  }

  const url = normalizeHttpsUrl(raw);
  if (url) {
    return { raw, kind: "url", url };
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    // normalizeHttpsUrl throws for all explicit schemes that are not HTTPS. This branch
    // is defensive for unusual URL parser behavior and keeps malformed URLs rejectable.
    throw new Error(`Malformed or unsafe source URL: ${raw}`);
  }

  // Existing repository references are validated; everything else is retained as a
  // citation string and is deliberately not treated as an official URL.
  if (
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith("knowledge-base/") ||
    raw.toLowerCase().endsWith(".md")
  ) {
    return resolveLocalReference(raw, context);
  }

  const embeddedUrl = raw.match(/[a-z][a-z\d+.-]*:\/\/[^\s,，)）\]]+/iu)?.[0];
  if (embeddedUrl) {
    const normalizedEmbeddedUrl = normalizeHttpsUrl(embeddedUrl);
    if (!normalizedEmbeddedUrl) {
      throw new Error(`Malformed source URL: ${embeddedUrl}`);
    }
    return { raw, kind: "citation", url: normalizedEmbeddedUrl };
  }

  return { raw, kind: "citation" };
}

function extractExcerpt(content: string): string {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const blocks = normalized
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const candidate =
    blocks.find((block) => !/^#{1,6}\s/u.test(block) && !/^```/u.test(block)) ?? blocks[0] ?? "";
  return candidate
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^>\s?/gmu, "")
    .replace(/^[-*+]\s+/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

export function parseKnowledgeFile(filePath: string, markdown: string): KnowledgeDocument {
  const context = resolveKnowledgePath(filePath);
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error(`Knowledge document is empty: ${filePath}`);
  }

  const parsed = matter(markdown);
  const metadata = frontmatterSchema.parse(parsed.data);
  const sourceReferences = metadata.sources.map((source) => classifySource(source, context));
  const sourceUrls = sourceReferences
    .flatMap((source) => (source.url ? [source.url] : []))
    .filter((url, index, urls) => urls.indexOf(url) === index);

  return {
    sourceId: metadata.id,
    title: metadata.title,
    jurisdiction: metadata.jurisdiction,
    evidenceStatus: metadata.evidence_status,
    lastVerified: normalizeDate(metadata.last_verified),
    excerpt: extractExcerpt(parsed.content),
    authority: metadata.authority,
    sourceUrls,
    sourceReferences,
    ...(metadata.category ? { category: metadata.category } : {}),
  };
}

export function isStale(lastVerified: string, now: Date, maxAgeDays = 90): boolean {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new RangeError("maxAgeDays must be a non-negative finite number");
  }
  const verifiedAt = Date.parse(`${lastVerified}T00:00:00.000Z`);
  if (Number.isNaN(verifiedAt)) {
    throw new RangeError(`Invalid lastVerified date: ${lastVerified}`);
  }
  return now.getTime() - verifiedAt > maxAgeDays * 24 * 60 * 60 * 1000;
}

export { resolveKnowledgePath as assertKnowledgePath };
