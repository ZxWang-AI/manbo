import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseKnowledgeFile, isStale } from "@/knowledge/frontmatter";
import { buildKnowledgeRegistry } from "@/knowledge/indexer";
import { createKnowledgeRetriever } from "@/knowledge/retriever";

const verifiedFixture = readFileSync(
  path.resolve("tests/fixtures/knowledge/verified.md"),
  "utf8",
);
const needsReviewFixture = readFileSync(
  path.resolve("tests/fixtures/knowledge/needs-review.md"),
  "utf8",
);

describe("knowledge source parsing", () => {
  it("parses evidence status and marks a source stale after 90 days", () => {
    const document = parseKnowledgeFile("knowledge-base/test/verified.md", verifiedFixture);

    expect(document.evidenceStatus).toBe("verified");
    expect(document.sourceUrls).toEqual(["https://www.example.gov/forced-labour"]);
    expect(isStale(document.lastVerified, new Date("2026-11-29T00:00:00.000Z"))).toBe(false);
    expect(isStale(document.lastVerified, new Date("2026-12-01T00:00:00.000Z"))).toBe(true);
  });

  it("never promotes needs-review to verified", () => {
    const document = parseKnowledgeFile("knowledge-base/test/needs-review.md", needsReviewFixture);

    expect(document.evidenceStatus).toBe("needs-review");
  });

  it("rejects paths outside knowledge-base markdown files", () => {
    expect(() => parseKnowledgeFile("docs/not-knowledge.md", verifiedFixture)).toThrow();
    expect(() => parseKnowledgeFile("knowledge-base/../README.md", verifiedFixture)).toThrow();
  });

  it("rejects non-HTTPS source URLs", () => {
    const insecure = verifiedFixture.replace(
      "https://www.example.gov/forced-labour",
      "http://www.example.gov/forced-labour",
    );

    expect(() => parseKnowledgeFile("knowledge-base/test/insecure.md", insecure)).toThrow(
      /HTTPS/u,
    );
  });

  it("rejects non-HTTPS URLs embedded inside a citation", () => {
    const insecure = verifiedFixture.replace(
      "https://www.example.gov/forced-labour",
      "Official source, http://www.example.gov/forced-labour",
    );

    expect(() => parseKnowledgeFile("knowledge-base/test/insecure-citation.md", insecure)).toThrow(
      /HTTPS/u,
    );
  });
});

describe("knowledge registry and retrieval", () => {
  it("indexes all 26 knowledge documents in stable source order", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");

    expect(registry).toHaveLength(26);
    expect(registry.map((entry) => entry.sourceId)).toEqual(
      [...registry].map((entry) => entry.sourceId).sort(),
    );
    expect(registry.every((entry) => !("stale" in entry) && !("warning" in entry))).toBe(true);
  });

  it("filters by jurisdiction and applies stale warning precedence", async () => {
    const registry = [
      {
        sourceId: "fixture-verified",
        title: "Verified forced labour law",
        jurisdiction: "美国",
        evidenceStatus: "verified" as const,
        lastVerified: "2026-01-01",
        excerpt: "forced labour law and reporting",
        sourceUrl: "https://www.example.gov/law",
        category: "laws",
      },
      {
        sourceId: "fixture-needs-review",
        title: "Review source",
        jurisdiction: "美国",
        evidenceStatus: "needs-review" as const,
        lastVerified: "2026-08-31",
        excerpt: "forced labour review",
        sourceUrl: "https://www.example.gov/review",
        category: "laws",
      },
      {
        sourceId: "fixture-design",
        title: "Design guidance",
        jurisdiction: "欧盟",
        evidenceStatus: "design" as const,
        lastVerified: "2026-08-31",
        excerpt: "forced labour design guidance",
        sourceUrl: "https://www.example.gov/design",
        category: "judgment",
      },
    ];

    const retriever = createKnowledgeRetriever(registry);
    const hits = await retriever.search("forced labour", {
      jurisdiction: "美国",
      now: new Date("2026-11-01T00:00:00.000Z"),
    });

    expect(hits.map((hit) => hit.sourceId)).toEqual([
      "fixture-needs-review",
      "fixture-verified",
    ]);
    expect(hits.find((hit) => hit.sourceId === "fixture-verified")?.warning).toBe("stale");
    expect(hits.find((hit) => hit.sourceId === "fixture-needs-review")?.warning).toBe(
      "needs_review",
    );
    expect(await retriever.search("forced labour", { jurisdiction: "中国" })).toEqual([]);
  });

  it("returns no result for an empty query", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");
    const retriever = createKnowledgeRetriever(registry);

    expect(await retriever.search("   ")).toEqual([]);
  });

  it("drops legal navigation entries without an official URL and records the error", async () => {
    const retriever = createKnowledgeRetriever([
      {
        sourceId: "citation-only-law",
        title: "Forced labour statute",
        jurisdiction: "美国",
        evidenceStatus: "needs-review",
        lastVerified: "2026-08-31",
        excerpt: "forced labour statute citation",
        category: "laws",
      },
    ]);

    expect(await retriever.search("forced labour", { jurisdiction: "美国" })).toEqual([]);
    expect(retriever.getIndexingErrors()).toEqual([
      expect.objectContaining({ sourceId: "citation-only-law" }),
    ]);
  });

  it("does not reuse one official URL across a multi-jurisdiction channel document", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");
    const retriever = createKnowledgeRetriever(registry);

    const hits = await retriever.search("举报 渠道", { jurisdiction: "德国" });

    expect(hits.find((hit) => hit.sourceId === "kb-channels")).toBeUndefined();
    expect(retriever.getIndexingErrors()).toContainEqual(
      expect.objectContaining({ sourceId: "kb-channels" }),
    );
  });

  it("keeps a canonical official URL for one-jurisdiction documents with supporting URLs", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");
    const retriever = createKnowledgeRetriever(registry);

    const hits = await retriever.search("实体 清单", { jurisdiction: "美国" });

    expect(hits.find((hit) => hit.sourceId === "kb-entity-lists")?.sourceUrl).toBe(
      "https://www.dhs.gov/uflpa-entity-list",
    );
  });

  it("does not expose cross-jurisdiction legal comparisons without an official URL", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");
    const retriever = createKnowledgeRetriever(registry);

    const hits = await retriever.search("主要 法域 定义", { jurisdiction: "中国" });

    expect(hits.find((hit) => hit.sourceId === "kb-jurisdiction-comparison")).toBeUndefined();
  });

  it("keeps indexing errors stable across repeated searches", async () => {
    const registry = await buildKnowledgeRegistry("knowledge-base");
    const retriever = createKnowledgeRetriever(registry);

    await retriever.search("强迫 劳动", { jurisdiction: "美国" });
    const firstErrors = retriever.getIndexingErrors();
    await retriever.search("强迫 劳动", { jurisdiction: "美国" });

    expect(retriever.getIndexingErrors()).toEqual(firstErrors);
  });

  it("applies stale warning before needs-review and exposes design warnings", async () => {
    const retriever = createKnowledgeRetriever([
      {
        sourceId: "stale-review",
        title: "Review source",
        jurisdiction: "通用",
        evidenceStatus: "needs-review",
        lastVerified: "2026-01-01",
        excerpt: "forced labour",
        sourceUrl: "https://www.example.gov/review",
        sourceUrls: ["https://www.example.gov/review"],
        category: "laws",
      },
      {
        sourceId: "fresh-design",
        title: "Design source",
        jurisdiction: "通用",
        evidenceStatus: "design",
        lastVerified: "2026-08-31",
        excerpt: "forced labour",
        sourceUrls: [],
        category: "judgment",
      },
    ]);

    const hits = await retriever.search("forced labour", {
      now: new Date("2026-11-01T00:00:00.000Z"),
    });

    expect(hits.find((hit) => hit.sourceId === "stale-review")?.warning).toBe("stale");
    expect(hits.find((hit) => hit.sourceId === "fresh-design")?.warning).toBe("design_source");
  });
});
