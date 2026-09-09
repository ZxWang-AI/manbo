import { describe, expect, it, vi } from "vitest";

import {
  MAX_LOCAL_MATERIAL_BYTES,
  createLocalMaterialPreview,
  scheduleMaterialRefresh,
} from "@/components/chat/material-upload-state";
import { readMaterialSummaries } from "@/components/chat/material-upload";

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

  it("distinguishes an invalid material response from a valid empty list", () => {
    expect(readMaterialSummaries({ materials: [] })).toEqual([]);
    expect(readMaterialSummaries({ materials: [{ materialId: "missing-fields" }] })).toBeNull();
    expect(readMaterialSummaries(null)).toBeNull();
  });
});
