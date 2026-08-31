import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { z } from "zod";

const dateSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.iso.date(),
);

const citationSchema = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .transform((value) => {
    if (typeof value === "string") {
      return value.trim();
    }

    return Object.entries(value)
      .map(([key, citationValue]) => `${key}:${String(citationValue)}`)
      .join(", ")
      .trim();
  })
  .pipe(z.string().min(1));

const frontmatterSchema = z.strictObject({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  category: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  authority: z.string().trim().min(1),
  last_verified: dateSchema,
  evidence_status: z.enum(["verified", "needs-review", "design"]),
  sources: z.array(citationSchema).min(1),
}).passthrough();

type KnowledgeIndexEntry = {
  category: string;
  evidenceStatus: "verified" | "needs-review" | "design";
  jurisdiction: string;
  lastVerified: string;
  sourceId: string;
  sourcePath: string;
  title: string;
};

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectMarkdownFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right, "en"));
}

async function buildKnowledgeIndex(knowledgeRoot: string): Promise<KnowledgeIndexEntry[]> {
  const files = await collectMarkdownFiles(knowledgeRoot);
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const markdown = await readFile(filePath, "utf8");
      const { data } = matter(markdown);
      const metadata = frontmatterSchema.parse(data);
      const sourcePath = path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");

      return {
        category: metadata.category,
        evidenceStatus: metadata.evidence_status,
        jurisdiction: metadata.jurisdiction,
        lastVerified: metadata.last_verified,
        sourceId: metadata.id,
        sourcePath,
        title: metadata.title,
      } satisfies KnowledgeIndexEntry;
    }),
  );

  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.sourceId)) {
      throw new Error(`Duplicate knowledge source id: ${entry.sourceId}`);
    }
    ids.add(entry.sourceId);
  }

  return entries.toSorted((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const knowledgeRoot = path.join(repositoryRoot, "knowledge-base");

try {
  const entries = await buildKnowledgeIndex(knowledgeRoot);
  process.stdout.write(`${JSON.stringify({ documentCount: entries.length, entries }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown indexing error";
  process.stderr.write(`Knowledge index validation failed: ${message}\n`);
  process.exitCode = 1;
}
