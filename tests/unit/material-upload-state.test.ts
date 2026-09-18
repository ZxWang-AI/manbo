import { describe, expect, it, vi } from "vitest";

import {
  MAX_LOCAL_MATERIAL_BYTES,
  createLocalMaterialPreview,
  scheduleMaterialRefresh,
} from "@/components/chat/material-upload-state";
import { collectSelectedContentRefs, readMaterialSummaries } from "@/components/chat/material-upload";

describe("local material preview state", () => {
  it("marks an in-limit browser file as a local-only preview", () => {
    expect(
      createLocalMaterialPreview({
        name: "pay-slip.pdf",
        size: MAX_LOCAL_MATERIAL_BYTES,
        lastModified: 123,
        index: 0,
      }),
    ).toMatchObject({
      id: "pay-slip.pdf-123-0",
      state: "local_preview",
    });
  });

  it("labels an oversized browser file as rejected by the size limit, not malicious", () => {
    expect(
      createLocalMaterialPreview({
        name: "large-video.mp4",
        size: MAX_LOCAL_MATERIAL_BYTES + 1,
        lastModified: 456,
        index: 0,
      }),
    ).toMatchObject({
      state: "rejected_size",
    });
  });

  it("defers and can cancel a material refresh callback", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const cancel = scheduleMaterialRefresh(refresh);

      expect(refresh).not.toHaveBeenCalled();
      vi.runOnlyPendingTimers();
      expect(refresh).toHaveBeenCalledOnce();

      const cancelledRefresh = vi.fn();
      const cancelPending = scheduleMaterialRefresh(cancelledRefresh);
      cancelPending();
      vi.runOnlyPendingTimers();
      expect(cancelledRefresh).not.toHaveBeenCalled();
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls at a bounded interval and stops after cancellation", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const cancel = scheduleMaterialRefresh(refresh, { intervalMs: 1_000 });

      vi.advanceTimersByTime(0);
      expect(refresh).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1_000);
      expect(refresh).toHaveBeenCalledTimes(2);

      cancel();
      vi.advanceTimersByTime(5_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes an invalid material response from a valid empty list", () => {
    expect(readMaterialSummaries({ materials: [] })).toEqual([]);
    expect(readMaterialSummaries({ materials: [{ materialId: "missing-fields" }] })).toBeNull();
    expect(readMaterialSummaries({ materials: [{
      materialId: "material-a",
      originalFilename: "statement.pdf",
      declaredBytes: 10,
      processingState: "parsed",
      aiContentRefs: ["derived/material-a-v1"],
    }] })).toEqual([expect.objectContaining({
      materialId: "material-a",
      aiContentRefs: ["derived/material-a-v1"],
    })]);
    expect(readMaterialSummaries(null)).toBeNull();
  });

  it("derives AI refs from the currently selected materials", () => {
    expect(collectSelectedContentRefs([
      { selectedForAi: true, aiContentRefs: ["derived/a", "derived/a"] },
      { selectedForAi: false, aiContentRefs: ["derived/old"] },
      { selectedForAi: true, aiContentRefs: ["derived/b"] },
    ])).toEqual(["derived/a", "derived/b"]);
  });
});
