import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildKnowledgeRegistry } from "@/knowledge/indexer";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const knowledgeRoot = path.join(repositoryRoot, "knowledge-base");
const registryPath = path.join(repositoryRoot, "src", "knowledge", "source-registry.json");

try {
  const registry = await buildKnowledgeRegistry(knowledgeRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  process.stdout.write(`Indexed ${registry.length} knowledge documents to ${registryPath}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown indexing error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
