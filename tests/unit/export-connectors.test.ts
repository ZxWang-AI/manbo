import { describe, expect, it } from "vitest";

import {
  createJsonConnector,
  createMarkdownConnector,
  createManualHandoffConnector,
  InMemoryExportPreviewStore,
} from "@/connectors";
import {
  makeManualConfirmation,
  makeJsonConfirmation,
  makeNarrativeConfirmation,
  makePrivateCaseRecord,
} from "../fixtures/connectors";

describe("user-controlled export connectors", () => {
  it("exports only user-confirmed fields and strips raw message text", async () => {
    const preview = await createMarkdownConnector().preview(
      makePrivateCaseRecord(),
      makeNarrativeConfirmation(),
    );

    expect(preview.text).toContain("用户报告（未经独立核实）");
    expect(preview.text).toContain("在工厂包装产品");
    expect(preview.text).not.toContain("我被要求在工厂工作");
    expect(preview.text).not.toContain("account-test-001");
  });

  it("serializes an allowlisted JSON shape without credentials or internal ids", async () => {
    const preview = await createJsonConnector().preview(
      makePrivateCaseRecord(),
      makeJsonConfirmation(),
    );
    const body = JSON.parse(preview.text) as Record<string, unknown>;

    expect(body).toMatchObject({
      disclaimer: "用户报告（未经独立核实）",
      facts: [{ field: "work_description", value: "在工厂包装产品", certainty: "user_stated" }],
    });
    expect(body).not.toHaveProperty("accountId");
    expect(preview.text).not.toContain("sourceQuote");
  });

  it("rejects fields that are not explicitly confirmed in the consent snapshot", () => {
    const connector = createMarkdownConnector();
    const record = makePrivateCaseRecord();
    const confirmation = {
      ...makeNarrativeConfirmation(),
      fieldPaths: ["/facts/0", "/facts/1"],
    };

    expect(connector.validate(record, confirmation)).toEqual([
      expect.objectContaining({ fieldPath: "/facts/1", code: "unconfirmed" }),
    ]);
  });

  it("never reports received without a target reference", async () => {
    const store = new InMemoryExportPreviewStore();
    const connector = createManualHandoffConnector({
      store,
      now: () => new Date("2026-09-02T00:00:00.000Z"),
      id: () => "export-1",
    });
    const record = makePrivateCaseRecord();
    const confirmation = makeManualConfirmation();
    const preview = await connector.preview(record, confirmation);
    const result = await connector.submit(record, confirmation, preview.exportId);

    expect(result).toEqual({
      kind: "manual_handoff",
      officialUrl: "https://manbo.example.org/manual-handoff",
      exportId: "export-1",
    });
  });

  it("rejects an expired or version-mismatched manual handoff preview", async () => {
    const store = new InMemoryExportPreviewStore();
    let now = new Date("2026-09-02T00:00:00.000Z");
    const connector = createManualHandoffConnector({ store, now: () => now, id: () => "export-2" });
    const record = makePrivateCaseRecord();
    const confirmation = makeManualConfirmation();
    const preview = await connector.preview(record, confirmation);

    await expect(connector.submit({ ...record, version: 2 }, confirmation, preview.exportId))
      .rejects.toThrow(/version/u);
    now = new Date("2026-09-02T00:16:00.000Z");
    await expect(connector.submit(record, confirmation, preview.exportId))
      .rejects.toThrow(/expired/u);
  });
});
