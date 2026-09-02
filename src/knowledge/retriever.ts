import { isStale } from "@/knowledge/frontmatter";
import type { KnowledgeRegistryEntry } from "@/knowledge/indexer";

export interface KnowledgeHit extends KnowledgeRegistryEntry {
  stale: boolean;
  warning?: "needs_review" | "design_source" | "stale";
}

export interface KnowledgeRetriever {
  search(query: string, options?: { jurisdiction?: string; now?: Date }): Promise<KnowledgeHit[]>;
  getIndexingErrors(): KnowledgeIndexingError[];
}

export interface KnowledgeIndexingError {
  sourceId?: string;
  message: string;
}

const NAVIGATION_CATEGORIES = new Set([
  "definitions",
  "laws",
  "reporting-channels",
  "import-export",
]);

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match[0]) tokens.add(match[0]);
  }
  for (const match of normalized.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/gu)) {
    if (match[0]) tokens.add(match[0]);
  }
  return [...tokens];
}

function isBroadJurisdiction(value: string): boolean {
  return value === "通用" || value === "多法域" || value.toLocaleLowerCase() === "global";
}

function jurisdictionMatches(entryJurisdiction: string, requested: string): boolean {
  const entry = normalizeText(entryJurisdiction);
  const query = normalizeText(requested);
  return (
    entry === query ||
    isBroadJurisdiction(entryJurisdiction) ||
    entry.split(/[、,，/|]/u).some((part) => normalizeText(part.trim()) === query)
  );
}

function legalEntryIsNavigable(entry: KnowledgeRegistryEntry): boolean {
  if (!NAVIGATION_CATEGORIES.has(entry.category ?? "")) {
    return true;
  }
  return Boolean(
    entry.sourceId.trim() &&
      entry.lastVerified.trim() &&
      entry.jurisdiction.trim() &&
      entry.sourceUrl &&
      /^https:\/\//i.test(entry.sourceUrl),
  );
}

function warningFor(entry: KnowledgeRegistryEntry, stale: boolean): KnowledgeHit["warning"] {
  if (stale) return "stale";
  if (entry.evidenceStatus === "needs-review") return "needs_review";
  if (entry.evidenceStatus === "design") return "design_source";
  return undefined;
}

export function createKnowledgeRetriever(
  registry: readonly KnowledgeRegistryEntry[],
): KnowledgeRetriever {
  const indexingErrors = new Map<string, KnowledgeIndexingError>();
  const entries = registry.filter((entry) => {
    if (legalEntryIsNavigable(entry)) return true;
    const error = {
      sourceId: entry.sourceId,
      message:
        "Navigation source requires sourceId, jurisdiction, lastVerified, and exactly one HTTPS sourceUrl",
    };
    indexingErrors.set(`${entry.sourceId}:${error.message}`, error);
    return false;
  });

  return {
    async search(query, options = {}) {
      const queryTokens = tokenize(query);
      if (queryTokens.length === 0) return [];

      const now = options.now ?? new Date();
      const matchedEntries: Array<{
        entry: KnowledgeRegistryEntry;
        matchedTokenCount: number;
        stale: boolean;
      }> = [];
      for (const entry of entries) {
        if (options.jurisdiction && !jurisdictionMatches(entry.jurisdiction, options.jurisdiction)) {
          continue;
        }
        const haystack = tokenize(
          [entry.title, entry.excerpt, entry.jurisdiction, entry.category ?? ""].join(" "),
        );
        const matchedTokenCount = queryTokens.reduce(
          (total, token) => total + (haystack.includes(token) ? 1 : 0),
          0,
        );
        if (matchedTokenCount === 0) continue;
        matchedEntries.push({
          entry,
          matchedTokenCount,
          stale: isStale(entry.lastVerified, now),
        });
      }

      return matchedEntries
        .sort(
          (left, right) =>
            right.matchedTokenCount - left.matchedTokenCount ||
            left.entry.sourceId.localeCompare(right.entry.sourceId, "en"),
        )
        .map(({ entry, stale }) => {
          const warning = warningFor(entry, stale);
          return {
            ...entry,
            stale,
            ...(warning ? { warning } : {}),
          };
        });
    },
    getIndexingErrors() {
      return [...indexingErrors.values()];
    },
  };
}

