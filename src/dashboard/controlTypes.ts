/** 터미널 탭 — 격자 필터와 동일. */
export type TabKey = "all" | "terminal1" | "terminal2" | "unknown";

export type DisplayMode = "cards" | "table" | "processing";

export const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "terminal1", label: "터미널1" },
  { key: "terminal2", label: "터미널2" },
];

/** 편명 검색 결과 한 줄(목록·격자 이동용). */
export type FlightSearchRow = {
  dedupeKey: string;
  sortMin: number;
  flight: string;
  hour: string;
  time: string;
  carousel: number;
};
