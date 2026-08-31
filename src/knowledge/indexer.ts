import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseKnowledgeFile, type KnowledgeEvidenceStatus } from "@/knowledge/frontmatter";

export interface KnowledgeRegistryEntry {
  sourceId: string;
  title: string;
  jurisdiction: string;
  evidenceStatus: KnowledgeEvidenceStatus;
  lastVerified: string;
  excerpt: string;
  sourceUrl?: string;
  /** Category is retained to enforce stricter legal/channel retrieval requirements. */
  category?: string;
}

export interface KnowledgeIndexingError {
  path: string;
  sourceId?: string;
  message: string;
}

let indexingErrors: KnowledgeIndexingError[] = [];

export function getKnowledgeIndexingErrors(): KnowledgeIndexingError[] {
  return [...indexingErrors];
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.isSymbolicLink())
      .map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return collectMarkdownFiles(entryPath);
        }
        return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [entryPath] : [];
      }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right, "en"));
}

function toRegistryEntry(document: ReturnType<typeof parseKnowledgeFile>): KnowledgeRegistryEntry {
  const sourceUrl = document.sourceUrls[0];
  return {
    sourceId: document.sourceId,
    title: document.title,
    jurisdiction: document.jurisdiction,
    evidenceStatus: document.evidenceStatus,
    lastVerified: document.lastVerified,
    excerpt: document.excerpt,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(document.category ? { category: document.category } : {}),
  };
}

export async function buildKnowledgeRegistry(rootDir: string): Promise<KnowledgeRegistryEntry[]> {
  indexingErrors = [];
  const root = path.resolve(rootDir);
  const files = await collectMarkdownFiles(root);
  const seenIds = new Map<string, string>();
  const entries: KnowledgeRegistryEntry[] = [];

  for (const filePath of files) {
    try {
      const markdown = await readFile(filePath, "utf8");
      const document = parseKnowledgeFile(filePath, markdown);
      const priorPath = seenIds.get(document.sourceId);
      if (priorPath) {
        throw new Error(
          `Duplicate knowledge source id "${document.sourceId}" (also found at ${priorPath})`,
        );
      }
      seenIds.set(document.sourceId, filePath);
      entries.push(toRegistryEntry(document));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown indexing error";
      indexingErrors.push({ path: filePath, message });
      throw new Error(`Knowledge index validation failed for ${filePath}: ${message}`, {
        cause: error,
      });
    }
  }

  return entries.toSorted((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
}

