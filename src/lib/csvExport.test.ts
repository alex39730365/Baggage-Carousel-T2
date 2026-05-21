import { describe, expect, it } from "vitest";
import type { BaggageSlot } from "../types";
import { buildBaggageSlotsCsv, spreadsheetSafeDateTime } from "./csvExport";

const baseSlot = (): BaggageSlot => ({
  date: "2026-05-13",
  hour: "14:00",
  carousel: 5,
  flight: "KE714",
  typeOfFlight: "I",
  estimatedTime: "202605131430",
  status: "OK",
  pieces: "120",
  note: "",
  raw: {},
});

describe("spreadsheetSafeDateTime", () => {
  it("12-digit compact → time only HH:mm", () => {
    expect(spreadsheetSafeDateTime("202605131430")).toBe("14:30");
  });
  it("14-digit compact → HH:mm:ss", () => {
    expect(spreadsheetSafeDateTime("20260513143055")).toBe("14:30:55");
  });
  it("8-digit → hyphenated date", () => {
    expect(spreadsheetSafeDateTime("20260513")).toBe("2026-05-13");
  });
  it("already human text preserved", () => {
    expect(spreadsheetSafeDateTime("14:30")).toBe("14:30");
  });
});

describe("buildBaggageSlotsCsv", () => {
  it("starts with UTF-8 BOM", () => {
    const csv = buildBaggageSlotsCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("includes header and CRLF", () => {
    const csv = buildBaggageSlotsCsv([]);
    const body = csv.slice(1);
    expect(body.startsWith("날짜,")).toBe(true);
    expect(body.includes("\r\n")).toBe(true);
  });

  it("maps estimatedTime through spreadsheetSafeDateTime", () => {
    const csv = buildBaggageSlotsCsv([baseSlot()]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toContain("예정시각");
    const data = lines[1]!;
    expect(data).toContain("14:30");
    expect(data).toContain("KE714");
  });

  it("escapes comma in flight", () => {
    const s = baseSlot();
    s.flight = "XX,YY";
    const csv = buildBaggageSlotsCsv([s]);
    expect(csv).toContain('"XX,YY"');
  });
});
