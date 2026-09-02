import { describe, expect, it } from "vitest";

describe("integration test harness", () => {
  it("runs independently from the browser test environment", () => {
    expect(typeof window).toBe("undefined");
  });
});
