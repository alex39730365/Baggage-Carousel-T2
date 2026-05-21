import { describe, expect, it } from "vitest";
import { shouldKeepSlotWithKeCodeshareFilter } from "./keCodeshareFilter";

describe("shouldKeepSlotWithKeCodeshareFilter", () => {
  it("keeps KE 2xxx and 8xxx", () => {
    expect(shouldKeepSlotWithKeCodeshareFilter("KE2001")).toBe(true);
    expect(shouldKeepSlotWithKeCodeshareFilter("KE 8178")).toBe(true);
  });

  it("keeps KE 9xxx charter flights", () => {
    expect(shouldKeepSlotWithKeCodeshareFilter("KE9001")).toBe(true);
    expect(shouldKeepSlotWithKeCodeshareFilter("KE 9123")).toBe(true);
  });

  it("hides other KE 4-digit codeshare-style numbers", () => {
    expect(shouldKeepSlotWithKeCodeshareFilter("KE7140")).toBe(false);
    expect(shouldKeepSlotWithKeCodeshareFilter("KE1234")).toBe(false);
  });

  it("hides other carriers 4-digit codeshare-style numbers", () => {
    expect(shouldKeepSlotWithKeCodeshareFilter("OZ1234")).toBe(false);
  });

  it("keeps non-4-digit and non-matching patterns", () => {
    expect(shouldKeepSlotWithKeCodeshareFilter("KE714")).toBe(true);
    expect(shouldKeepSlotWithKeCodeshareFilter("KE714 / NRT")).toBe(true);
  });
});
