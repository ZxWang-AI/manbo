import { describe, expect, it } from "vitest";

import {
  MAX_CASE_MATERIAL_BYTES,
  MAX_MATERIAL_BYTES,
  MaterialStorageLimitExceeded,
  assertMaterialReservationAllowed,
  createOpaqueMaterialObjectKey,
} from "@/domain/material";

describe("material storage limits", () => {
  it("accepts the exact per-file and per-case limits", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: MAX_MATERIAL_BYTES,
        usedBytes: MAX_CASE_MATERIAL_BYTES - MAX_MATERIAL_BYTES,
        reservedBytes: 0,
      }),
    ).not.toThrow();
  });

  it("rejects a file larger than 100 MB before upload", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: MAX_MATERIAL_BYTES + 1,
        usedBytes: 0,
        reservedBytes: 0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialStorageLimitExceeded>>({
        code: "FILE_STORAGE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("counts active reservations toward the 2 GB case limit", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: 2,
        usedBytes: MAX_CASE_MATERIAL_BYTES - 2,
        reservedBytes: 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialStorageLimitExceeded>>({
        code: "CASE_STORAGE_LIMIT_EXCEEDED",
      }),
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid byte length: %s",
    (byteLength) => {
      expect(() =>
        assertMaterialReservationAllowed({ byteLength, usedBytes: 0, reservedBytes: 0 }),
      ).toThrow(/positive integer/i);
    },
  );

  it("creates an opaque object key that does not embed case or filename data", () => {
    const key = createOpaqueMaterialObjectKey(() => Buffer.alloc(16, 3));

    expect(key).toMatch(/^materials\/[a-f0-9]{32}$/);
    expect(key).not.toContain("case");
    expect(key).not.toContain("passport.pdf");
  });
});
