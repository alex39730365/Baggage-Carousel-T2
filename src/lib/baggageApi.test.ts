import { describe, expect, it } from "vitest";
import type { BaggageSlot } from "../types";
import {
  diffMinutesArrivalToLastBaggage,
  getBagLastTimeUtcMs,
  parseSeoulWallClock,
  pickBucketTimeWithStableDate,
  sanitizeFetchErrorBody,
} from "./baggageApi";

describe("parseSeoulWallClock", () => {
  it("parses compact YYYYMMDDHHmm as Seoul wall", () => {
    expect(parseSeoulWallClock("202605131430")).toEqual({
      dateKey: "2026-05-13",
      hh: 14,
      mm: 30,
    });
  });

  it("parses compact with spaces stripped", () => {
    expect(parseSeoulWallClock("20260513 1430")).toEqual({
      dateKey: "2026-05-13",
      hh: 14,
      mm: 30,
    });
  });

  it("does not treat ISO+Z as digit-only compact (avoid stripping zone)", () => {
    const z = parseSeoulWallClock("2026-05-13T05:30:00Z");
    expect(z).not.toBeNull();
    expect(z!.dateKey).toBe("2026-05-13");
    expect(z!.hh).toBe(14);
    expect(z!.mm).toBe(30);
  });

  it("treats timezone-less ISO as Seoul wall, not browser local", () => {
    expect(parseSeoulWallClock("2026-05-13T14:30:00")).toEqual({
      dateKey: "2026-05-13",
      hh: 14,
      mm: 30,
    });
    expect(parseSeoulWallClock("2026-05-13 14:30")).toEqual({
      dateKey: "2026-05-13",
      hh: 14,
      mm: 30,
    });
  });

  it("parses Seoul offset via Date branch", () => {
    const r = parseSeoulWallClock("2026-05-13T14:30:00+09:00");
    expect(r).toEqual({ dateKey: "2026-05-13", hh: 14, mm: 30 });
  });
});

describe("getBagLastTimeUtcMs", () => {
  it("reads last bag from alternate raw keys", () => {
    const slot: BaggageSlot = {
      date: "2026-05-13",
      hour: "14:00",
      carousel: 3,
      flight: "ZZ999",
      typeOfFlight: "I",
      estimatedTime: "202605131400",
      status: "",
      pieces: "",
      note: "",
      raw: { lastBagTime: "202605131500" },
    };
    const ms = getBagLastTimeUtcMs(slot);
    expect(ms).not.toBeNull();
    const back = new Date(ms!);
    expect(back.getUTCHours()).toBe(6);
    expect(back.getUTCMinutes()).toBe(0);
  });
});

describe("sanitizeFetchErrorBody", () => {
  it("replaces HTML 502 gateway page with a short message", () => {
    const html = `<html><body><h1>502 Bad Gateway</h1> The server returned an invalid or incomplete response. </body></html>`;
    const s = sanitizeFetchErrorBody(html, 502);
    expect(s).toContain("502");
    expect(s).not.toContain("<html>");
    expect(s).not.toContain("<body>");
  });

  it("sanitizes HTML inside JSON message field", () => {
    const wrapped = JSON.stringify({
      message: `<html><body><h1>502 Bad Gateway</h1></body></html>`,
    });
    const s = sanitizeFetchErrorBody(wrapped, 502);
    expect(s).not.toContain("<html>");
    expect(s).toContain("502");
  });

  it("sanitizes JSON.parse error style strings", () => {
    const m = `Unexpected token '<', "<html><body><h1>502 Bad Gateway</h1></body></html>" is not valid JSON`;
    const s = sanitizeFetchErrorBody(m, 200);
    expect(s).not.toContain("<html>");
  });
});

describe("diffMinutesArrivalToLastBaggage", () => {
  it("computes minutes from arrival to L on same calendar day", () => {
    const m = diffMinutesArrivalToLastBaggage("202605131400", "202605131430", "2026-05-13");
    expect(m).toBe(30);
  });
});

describe("pickBucketTimeWithStableDate", () => {
  it("uses estimated time for a genuine red-eye delay across midnight", () => {
    // KE852-like: scheduled 21:40, estimated next day 00:06
    const picked = pickBucketTimeWithStableDate("202604242140", "202604250006");
    expect(picked).toBe("202604250006");
  });

  it("falls back to schedule for arbitrary one-day-off estimated dates", () => {
    // estimated date is wrong by one day but time is same
    const picked = pickBucketTimeWithStableDate("202604242140", "202604252140");
    expect(picked).toBe("202604242140");
  });

  it("uses schedule when estimated is an unusual early-morning without late-night schedule", () => {
    const picked = pickBucketTimeWithStableDate("202604241200", "202604250100");
    expect(picked).toBe("202604241200");
  });

  it("uses estimated for a late-night flight delayed just past midnight", () => {
    // TW248-like: scheduled 23:55, estimated next day 00:07
    const picked = pickBucketTimeWithStableDate("202608022355", "202608030007");
    expect(picked).toBe("202608030007");
  });

  it("prefers schedule when the cross-midnight delay is too long", () => {
    const picked = pickBucketTimeWithStableDate("202604242100", "202604250900");
    expect(picked).toBe("202604242100");
  });
});
