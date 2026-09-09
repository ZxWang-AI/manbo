import { describe, expect, it, vi } from "vitest";

import {
  bootstrapPersistence,
  PersistenceBootstrapError,
} from "@/components/chat/persistence-bootstrap";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const draft = {
  schemaVersion: "1.0" as const,
  visibility: "private" as const,
  lifecycle: "draft" as const,
  jurisdiction: {},
  facts: [],
  timeline: [],
  iloIndicators: [],
  elements: {
    workOrService: { status: "unknown" as const, basis: [], missing: ["待补充"] },
    involuntary: { status: "unknown" as const, basis: [], missing: ["待补充"] },
    penaltyOrThreat: { status: "unknown" as const, basis: [], missing: ["待补充"] },
  },
  evidenceCoverage: [],
  legalNavigation: [],
  referrals: [],
  safetyFlags: [],
  sourceTrace: [],
  consent: { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
};

describe("bootstrapPersistence", () => {
  it("falls back to preview mode when the account service is degraded", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ code: "DEGRADED" }, 503));

    await expect(bootstrapPersistence(fetcher, draft)).resolves.toEqual({ mode: "preview" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("creates an account and private case and returns the one-time recovery secret", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ alias: "quiet-river-abcd", recoverySecret: "once-only" }, 201))
      .mockResolvedValueOnce(response({ case: { caseId: "case-123" } }, 201));

    await expect(bootstrapPersistence(fetcher, draft)).resolves.toEqual({
      mode: "persistent",
      caseId: "case-123",
      alias: "quiet-river-abcd",
      recoverySecret: "once-only",
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/accounts", { method: "POST" });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft }),
    });
  });

  it("returns the current case version so later user edits can use optimistic concurrency", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ alias: "quiet-river-abcd", recoverySecret: "once-only" }, 201))
      .mockResolvedValueOnce(response({ case: { caseId: "case-versioned", version: 4 } }, 201));

    await expect(bootstrapPersistence(fetcher, draft)).resolves.toEqual({
      mode: "persistent",
      caseId: "case-versioned",
      alias: "quiet-river-abcd",
      recoverySecret: "once-only",
      version: 4,
    });
  });

  it("fails closed when the account exists but the private case cannot be created", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ alias: "quiet-river-abcd", recoverySecret: "once-only" }, 201))
      .mockResolvedValueOnce(response({ code: "DEGRADED" }, 503));

    await expect(bootstrapPersistence(fetcher, draft)).rejects.toMatchObject({
      code: "CASE_CREATE_FAILED",
    } satisfies Partial<PersistenceBootstrapError>);
  });

  it("treats an unavailable account network as preview without creating an unbound case", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network down"));

    await expect(bootstrapPersistence(fetcher, draft)).resolves.toEqual({ mode: "preview" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
