import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBaggageData } from "../hooks/useBaggageData";
import {
  collapseDuplicateFlightsPreferClassified,
  compareSlotsByEstimatedArrival,
  diffMinutesArrivalToLastBaggage,
  getSlotDedupeKey,
  getSortableMinuteOfDay,
  isBagLastTimePassed,
  sanitizeFlightDisplay,
} from "../lib/baggageApi";
import { BaggageSlot } from "../types";
import { CarouselDataGrid } from "./CarouselDataGrid";

/** 목록·시트·호버 팝오버 쌓임 (Tailwind z 단계와 맞춤) */
const Z_LIST_CARD_RAISED = "z-30";
const Z_LIST_TOOLBAR = "z-40";
const Z_LIST_HOVER_POPOVER = "z-50";
const Z_SHEET_BACKDROP = "z-[90]";
const Z_SHEET_PANEL = "z-[100]";
/** 목록 상단 스티키 바 높이 — 시간대 제목 `sticky top`과 동일 값 */
const LIST_STICKY_TOOLBAR_HEIGHT = "2.75rem";

const HIGHLIGHT_STORAGE_KEY = "baggage-highlight-keys-v2";

const loadHighlightSet = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
};

const persistHighlights = (keys: Set<string>) => {
  try {
    localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore
  }
};

/** 목록·격자 카드 공통: 테두리+배경 (비강조는 기존과 비슷한 톤). */
const highlightShellClass = (on: boolean) =>
  on
    ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200"
    : "border-slate-200 bg-white";

/** 모바일 최소 터치 영역(~44px), sm 이상은 조금 줄여 격자 밀도 유지 */
const highlightMarkHitClass = "min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9";
const highlightMarkButtonBaseClass = [
  "inline-flex shrink-0 items-center justify-center rounded-md leading-none",
  "text-slate-400 active:bg-slate-300/80 active:text-slate-700",
  "hover:bg-slate-200/60 hover:text-slate-600",
  highlightMarkHitClass,
].join(" ");
/** 목록 카드 별 */
const highlightMarkButtonClassList = `${highlightMarkButtonBaseClass} text-[15px]`;

/** 편명 검색에서 줄·해당 슬롯을 잠깐 강조할 때 (약 2초, 분홍). */
const NAVIGATE_FLASH_MS = 2000;
const navigateFlashShellClass =
  "z-[1] bg-pink-100 ring-4 ring-pink-400 shadow-[0_0_14px_rgba(236,72,153,0.55)]";

const CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY = "baggage-carousel-10-11-guide-v2";

const loadCarouselGuideVisible = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return false;
};

const persistCarouselGuideVisible = (visible: boolean) => {
  try {
    localStorage.setItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // ignore
  }
};

/** 목록(cards) 뷰에서 비어 있어도 시간대 제목·안내가 보이게 할 구간(14시~23시) */
const LIST_VIEW_ALWAYS_SHOW_HOURS = new Set(
  Array.from({ length: 10 }, (_, i) => `${String(14 + i).padStart(2, "0")}:00`)
);

/** 모바일 격자 보기 확대 (핀치·버튼). */
const MOBILE_GRID_ZOOM_MIN = 1;
const MOBILE_GRID_ZOOM_MAX = 1.85;
const clampMobileGridZoom = (z: number) =>
  Math.min(MOBILE_GRID_ZOOM_MAX, Math.max(MOBILE_GRID_ZOOM_MIN, z));
type TabKey = "all" | "terminal1" | "terminal2" | "unknown";
type DisplayMode = "cards" | "table" | "processing";

const isGridTableMode = (m: DisplayMode) => m === "table" || m === "processing";

const LIST_PROCESSING_HOVER_KEY = "baggage-list-processing-hover-v1";

const loadListProcessingHoverPopover = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(LIST_PROCESSING_HOVER_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return true;
};

const persistListProcessingHoverPopover = (enabled: boolean) => {
  try {
    localStorage.setItem(LIST_PROCESSING_HOVER_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};

const DISPLAY_MODE_STORAGE_KEY = "baggage-display-mode-v1";
const DISPLAY_MODE_SESSION_KEY = "baggage-display-mode-session-v1";
const KE_CODESHARE_FILTER_STORAGE_KEY = "baggage-ke-codeshare-filter-v1";
/** localStorage 실패 시 같은 탭 새로고침용 보조 저장 */
const KE_CODESHARE_FILTER_SESSION_KEY = "baggage-ke-codeshare-filter-session-v1";

const loadDisplayMode = (): DisplayMode | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DISPLAY_MODE_SESSION_KEY);
    if (raw === "cards" || raw === "table" || raw === "processing") return raw;
  } catch {
    // ignore
  }
  return null;
};

const persistDisplayMode = (mode: DisplayMode) => {
  try {
    sessionStorage.setItem(DISPLAY_MODE_SESSION_KEY, mode);
  } catch {
    // ignore
  }
};

const loadKeCodeshareFilter = (): boolean => {
  // 요청사항: 웹사이트 시작 시 코드셰어 필터를 항상 켠 상태로 시작.
  return true;
};

const persistKeCodeshareFilter = (on: boolean) => {
  const v = on ? "1" : "0";
  try {
    localStorage.setItem(KE_CODESHARE_FILTER_STORAGE_KEY, v);
  } catch {
    // ignore
  }
  try {
    sessionStorage.setItem(KE_CODESHARE_FILTER_SESSION_KEY, v);
  } catch {
    // ignore
  }
};

/** 예전 키 `baggage-ke-yellow-highlight-v1`와 호환 — 설정 유지 */
const KE_PINK_HIGHLIGHT_STORAGE_KEY = "baggage-ke-pink-highlight-v1";
const KE_PINK_HIGHLIGHT_LEGACY_KEY = "baggage-ke-yellow-highlight-v1";

const loadKePinkHighlight = (): boolean => {
  if (typeof window === "undefined") return false;
  const read = (key: string): boolean | null => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore
    }
    return null;
  };
  // 저장값 없을 때 기본 ON — KE 본편 파랑 강조. (Cursor 단순 미리보기와 Chrome 등은 localStorage가 달라 한쪽만 켜진 것처럼 보일 수 있음)
  return read(KE_PINK_HIGHLIGHT_STORAGE_KEY) ?? read(KE_PINK_HIGHLIGHT_LEGACY_KEY) ?? true;
};

/**
 * IATA 2자 + 숫자 4자리는 코드셰어 표기로 보고 숨김.(7C·KE 등 — `7C`는 앞이 숫자라 [A-Z]{2}로는 잡히지 않음)
 * 예외: KE + 4자리 + 천의 자리 2 또는 8(KE 2000, KE8178 등)만 유지.
 * 3자리·5자리 이상·패턴이 다른 편명은 그대로 둔다.
 */
const shouldKeepSlotWithKeCodeshareFilter = (flight: string): boolean => {
  const compact = flight.trim().toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!m) return true;
  const carrier = m[1];
  const digits = m[2];
  if (digits.length !== 4) return true;
  if (carrier === "KE" && (digits[0] === "2" || digits[0] === "8")) return true;
  return false;
};

/** `KE714 / NRT`, `KE 712` 등 본편 KE(앞부분이 KE+숫자) */
const isMainlineKeFlight = (flight: string): boolean => {
  const head =
    flight
      .trim()
      .split(/\s*\/\s*/)[0]
      ?.replace(/\s+/g, "")
      .toUpperCase() ?? "";
  return /^KE\d/.test(head);
};

/** KE 본편 — 자동 강조(파랑). 뷰포트·미리보기 창 너비와 무관하게 격자에서도 보이도록 한 톤으로 통일 */
const keBlueShellClass =
  "border-blue-500 bg-blue-100 ring-2 ring-blue-400/80";
/** KE 본편 — 별·격자 클릭으로 켠 강조(분홍) */
const keStarKeShellClass = "border-pink-300 bg-pink-50 ring-1 ring-pink-200";

/** 마지막 수하물(L) 시각 경과 — 항공편 칸 회색(내부 글자는 `index.css` `.last-bag-past-cell`) */
const lastBagPastShellClass = "last-bag-past-cell border-slate-300 ring-1 ring-slate-200";
/** L 경과 + KE 본편 — 연한 파랑(`index.css` `.ke-last-bag-past-cell`) */
const keLastBagPastShellClass = "ke-last-bag-past-cell border-blue-200 ring-1 ring-blue-200/80";

const slotShellClass = (
  starHighlighted: boolean,
  flight: string,
  kePinkOn: boolean,
  lastBaggagePast: boolean
) =>
  starHighlighted
    ? isMainlineKeFlight(flight)
      ? keStarKeShellClass
      : highlightShellClass(true)
    : lastBaggagePast
      ? isMainlineKeFlight(flight)
        ? keLastBagPastShellClass
        : lastBagPastShellClass
      : kePinkOn && isMainlineKeFlight(flight)
        ? keBlueShellClass
        : highlightShellClass(false);

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "terminal1", label: "터미널1" },
  { key: "terminal2", label: "터미널2" },
];

/** 관리자 대시보드: 흰 카드·행(좌 라벨 / 우 컨트롤) */
const DASH_CARD =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5 sm:py-4";
const DASH_ROW = "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-start sm:gap-4 md:gap-6";
const DASH_LABEL =
  "shrink-0 text-sm font-semibold leading-tight tracking-tight text-slate-600 sm:min-w-[5.5rem] md:min-w-[6rem]";
const dashBtn = (on: boolean) =>
  [
    "rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:text-[13px]",
    on
      ? "border-[#1e40af] bg-[#1e40af] text-white shadow-sm"
      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");
const DASH_SELECT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-shadow focus:border-[#1e40af]/55 focus:ring-2 focus:ring-[#1e40af]/18 sm:w-auto sm:min-w-[12rem] sm:max-w-[16rem]";
const DASH_INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-shadow placeholder:text-slate-400 focus:border-[#1e40af]/55 focus:ring-2 focus:ring-[#1e40af]/18 sm:max-w-md sm:min-w-[18rem]";

const formatTime = (value: string) => {
  const compact = value.replace(/\D/g, "");
  if (compact.length >= 12) return `${compact.slice(8, 10)}:${compact.slice(10, 12)}`;
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
};

const pickRawString = (raw: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = String(Math.trunc(v));
      if (s.replace(/\D/g, "").length >= 8) return s;
    }
  }
  return "";
};

/** 첫·마지막 벨트 시각 중 하나라도 있으면(진행 중 포함) 처리 시간 탭·ⓘ 등에서 의미 있음 */
const hasBaggageProcessingTimes = (item: BaggageSlot): boolean => {
  const raw = item.raw as Record<string, unknown>;
  return (
    Boolean(pickRawString(raw, ["bagFirstTime", "bagfirstTime"])) ||
    Boolean(pickRawString(raw, ["bagLastTime", "baglastTime"]))
  );
};

/** 수하물 처리 시간: 편명 / ATA / F(표시만) / L — 소요 분은 ATA~L만 사용 */
const getProcessingParts = (item: BaggageSlot) => {
  const flight =
    sanitizeFlightDisplay((item.flight || "미지정").trim())
      .split(/\s*\/\s*/)[0]
      ?.trim() || "미지정";
  const atRaw = (item.estimatedTime || "").trim();
  const at = (formatTime(atRaw) || "").trim() || "—";
  const raw = item.raw as Record<string, unknown>;
  const firstRaw = pickRawString(raw, ["bagFirstTime", "bagfirstTime"]);
  const lastRaw = pickRawString(raw, ["bagLastTime", "baglastTime"]);
  const hasFirst = Boolean(firstRaw.trim());
  const hasLast = Boolean(lastRaw.trim());
  const f = hasFirst ? formatTime(firstRaw) : "";
  const l = hasLast ? formatTime(lastRaw) : "";
  return { flight, at, f, l, lastRaw, hasFirst, hasLast };
};

const ProcessingLines = ({
  flight,
  at,
  f,
  l,
  hasFirst,
  hasLast,
  compact,
}: {
  flight: string;
  at: string;
  f: string;
  l: string;
  hasFirst: boolean;
  hasLast: boolean;
  compact: boolean;
}) => {
  const row = compact ? "text-[10px] leading-tight" : "text-sm leading-snug";
  return (
    <div className={`min-w-0 max-w-full space-y-0.5 font-bold tabular-nums text-slate-950 [overflow-wrap:anywhere] ${row}`}>
      <p>{flight}</p>
      <p>
        ATA {at}
      </p>
      {hasFirst && f ? (
        <p>
          F {f}
        </p>
      ) : null}
      {hasLast && l ? (
        <p>
          L {l}
        </p>
      ) : null}
    </div>
  );
};

const ProcessingSlotDetail = ({
  item,
  compact,
  abbrevLegend,
}: {
  item: BaggageSlot;
  compact?: boolean;
  /** ATA/F/L 영문 설명 — 시트 등에서만 사용 */
  abbrevLegend?: boolean;
}) => {
  const { flight, at, f, l, lastRaw, hasFirst, hasLast } = getProcessingParts(item);
  const minutes = diffMinutesArrivalToLastBaggage(
    (item.estimatedTime || "").trim(),
    lastRaw,
    item.date
  );
  return compact ? (
    <>
      <ProcessingLines
        flight={flight}
        at={at}
        f={f}
        l={l}
        hasFirst={hasFirst}
        hasLast={hasLast}
        compact
      />
      {minutes != null && (
        <p className="pt-0.5 text-[9px] font-semibold tabular-nums text-indigo-700">소요 {minutes}분</p>
      )}
    </>
  ) : (
    <>
      <ProcessingLines
        flight={flight}
        at={at}
        f={f}
        l={l}
        hasFirst={hasFirst}
        hasLast={hasLast}
        compact={false}
      />
      {minutes != null && <p className="mt-1 text-sm font-semibold text-indigo-700">소요 {minutes}분</p>}
      {abbrevLegend ? (
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-slate-500">
          <p>ATA = Arrival time</p>
          <p>F = First baggage (ATA와 L 사이 참고 표시)</p>
          <p>L = Last baggage</p>
          <p className="pt-0.5">소요 시간은 ATA부터 L까지 (F는 계산에 미포함)</p>
        </div>
      ) : null}
    </>
  );
};

const getAirportCode = (raw: Record<string, unknown>): string => {
  const code = raw.airportCode;
  if (typeof code === "string" && code.trim()) return code.trim();
  const airport = raw.airport;
  if (typeof airport === "string" && airport.trim()) return airport.trim();
  return "UNK";
};

/** `BX165 / NRT` 처럼 편명 끝에 이미 공항 코드가 있으면 raw와 중복 표기하지 않음 */
const tailTokenFromFlight = (flight: string): string | null => {
  const parts = flight
    .trim()
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]?.toUpperCase() ?? "";
  if (!last || !/^[A-Z]{2,4}$/.test(last)) return null;
  return last;
};

const formatFlightAirportLine = (item: BaggageSlot): string => {
  const f = sanitizeFlightDisplay((item.flight || "미지정").trim());
  const code = getAirportCode(item.raw).trim();
  const tail = tailTokenFromFlight(f);
  if (code && tail && code.toUpperCase() === tail) return f;
  if (!code || code === "UNK") return f;
  return `${f} / ${code}`;
};

const getStand = (raw: Record<string, unknown>): string => {
  const stand = raw.fstandPosition ?? raw.gateNumber;
  if (typeof stand === "string" && stand.trim()) return stand.trim();
  if (typeof stand === "number") return String(stand);
  return "-";
};

/** IIAC 공공데이터에서 쓰는 터미널 코드만 인정 (게이트·스탠드 숫자 '106' 등은 제외). */
const normalizeTerminalToken = (value: unknown): string => {
  if (typeof value === "string") return value.trim().toUpperCase().replace(/\uFEFF/g, "");
  if (typeof value === "number" && Number.isFinite(value)) return String(value).trim().toUpperCase();
  return "";
};

const getTerminal = (raw: Record<string, unknown>): string => {
  for (const key of ["terminalId", "terminal"] as const) {
    const t = normalizeTerminalToken(raw[key]);
    if (!t) continue;
    if (/^P0[123]$/.test(t)) return t;
    if (/^T[12]$/.test(t)) return t;
    if (/^TERMINAL[12]$/.test(t)) return t;
  }
  return "";
};

const getTerminalGroup = (raw: Record<string, unknown>): "terminal1" | "terminal2" | "unknown" => {
  const terminal = getTerminal(raw);
  if (!terminal) return "unknown";

  /**
   * IIAC 공공데이터 여객 터미널 코드(공공데이터포털 등 기준):
   * - P01 제1여객터미널, P02 탑승동(제1 쪽 연계) → 터미널1 탭
   * - P03 제2여객터미널 → 터미널2 탭
   * (게이트 문자열에 '1' 포함 같은 추측은 쓰지 않음)
   */
  if (terminal === "P01" || terminal === "P02" || terminal === "T1" || terminal === "TERMINAL1") return "terminal1";
  if (terminal === "P03" || terminal === "T2" || terminal === "TERMINAL2") return "terminal2";

  return "unknown";
};

const filterByTab = (slots: BaggageSlot[], tab: TabKey): BaggageSlot[] => {
  if (tab === "all") return slots;
  if (tab === "terminal1") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal1");
  if (tab === "terminal2") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal2");
  return slots.filter((slot) => getTerminalGroup(slot.raw) === "unknown");
};

/** 출발(O)만 제외 — I·D·구분 없음(고정 스케줄)은 표시. */
const excludeOutboundFlights = (slots: BaggageSlot[]): BaggageSlot[] =>
  slots.filter((slot) => (slot.typeOfFlight ?? "").trim().toUpperCase() !== "O");

const TimeStandLine = ({ time, stand, compact }: { time: string; stand: string; compact?: boolean }) => (
  <p
    className={
      compact
        ? "min-w-0 max-w-full break-words leading-tight text-slate-600 [overflow-wrap:anywhere]"
        : "text-slate-600"
    }
  >
    <span className={`font-bold tabular-nums text-slate-950 ${compact ? "text-[10px] sm:text-[11px]" : "text-xs sm:text-sm"}`}>
      {time}
    </span>
    <span className={compact ? "text-slate-600" : ""}> / {stand}</span>
  </p>
);

const EmptyState = ({ message }: { message: string }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center">
    <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-500">
      i
    </div>
    <p className="text-sm text-slate-600">{message}</p>
  </div>
);

const SlotDetail = ({
  item,
  compact,
  flightLineClassName,
}: {
  item: BaggageSlot;
  compact?: boolean;
  /** 목록 등: 편명 줄에 `cursor-help` 등 */
  flightLineClassName?: string;
}) => {
  const timeStr = formatTime(item.estimatedTime);
  const standStr = getStand(item.raw);
  const flightLineExtra = flightLineClassName?.trim() ? ` ${flightLineClassName.trim()}` : "";
  return compact ? (
    <>
      <p
        className={`min-w-0 max-w-full break-words text-[11px] font-bold leading-tight text-slate-950 [overflow-wrap:anywhere]${flightLineExtra}`}
      >
        {formatFlightAirportLine(item)}
      </p>
      <TimeStandLine time={timeStr} stand={standStr} compact />
      {!!item.pieces && (
        <p className="min-w-0 max-w-full break-words leading-tight text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  ) : (
    <>
      <p className={`text-sm font-bold text-slate-950${flightLineExtra}`}>
        {formatFlightAirportLine(item)}
      </p>
      <TimeStandLine time={timeStr} stand={standStr} />
      {!!item.pieces && (
        <p className="text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  );
};

export default function BaggageCarouselBoard() {
  const { hours, loading, error, refreshError, lastUpdated, slots, slotsByDate, selectedDate, setSelectedDate } =
    useBaggageData();
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("terminal2");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => loadDisplayMode() ?? "table");
  const [hideKeCodeshareFlights, setHideKeCodeshareFlights] = useState(() => loadKeCodeshareFilter());
  const [kePinkHighlight] = useState(() => loadKePinkHighlight());
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(loadHighlightSet);
  const [navigateFlashKey, setNavigateFlashKey] = useState<string | null>(null);
  const navigateFlashTimerRef = useRef<number | null>(null);
  /** 목록: 항공편 호버 시 뜨는 수하물 처리 시간 작은 창 */
  const [listProcessingHoverPopover, setListProcessingHoverPopover] = useState(
    () => loadListProcessingHoverPopover()
  );
  const [processingPopoverSlotKey, setProcessingPopoverSlotKey] = useState<string | null>(null);
  const processingPopoverLeaveTimerRef = useRef<number | null>(null);
  /** (hover: none) — 터치 위주 기기에서 목록 카드 ⓘ 시트 */
  const [prefersNoHover, setPrefersNoHover] = useState(false);
  const [listProcessingSheetSlotKey, setListProcessingSheetSlotKey] = useState<string | null>(null);
  const [isMobileGridViewport, setIsMobileGridViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false
  );
  const [mobileGridZoom, setMobileGridZoom] = useState(1);
  const mobileGridZoomRef = useRef(1);
  const tablePinchWrapRef = useRef<HTMLDivElement>(null);
  const pinchGestureRef = useRef<{ dist0: number; zoom0: number } | null>(null);
  const [carouselGuideVisible, setCarouselGuideVisible] = useState(() => loadCarouselGuideVisible());
  /** L 시각 경과 회색 — 1분마다 갱신 */
  const [, setBaggageClockTick] = useState(0);
  mobileGridZoomRef.current = mobileGridZoom;

  useEffect(() => {
    const id = window.setInterval(() => setBaggageClockTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const nowMs = Date.now();

  const toggleCarouselGuide = useCallback(() => {
    setCarouselGuideVisible((prev) => {
      const next = !prev;
      persistCarouselGuideVisible(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const upd = () => setIsMobileGridViewport(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  useEffect(() => {
    if (!isGridTableMode(displayMode)) setMobileGridZoom(1);
  }, [displayMode]);

  const cancelProcessingPopoverLeaveTimer = useCallback(() => {
    const t = processingPopoverLeaveTimerRef.current;
    if (t !== null) {
      window.clearTimeout(t);
      processingPopoverLeaveTimerRef.current = null;
    }
  }, []);

  const openProcessingPopover = useCallback(
    (key: string) => {
      if (!listProcessingHoverPopover) return;
      cancelProcessingPopoverLeaveTimer();
      setProcessingPopoverSlotKey(key);
    },
    [cancelProcessingPopoverLeaveTimer, listProcessingHoverPopover]
  );

  const scheduleCloseProcessingPopover = useCallback(() => {
    cancelProcessingPopoverLeaveTimer();
    processingPopoverLeaveTimerRef.current = window.setTimeout(() => {
      setProcessingPopoverSlotKey(null);
      processingPopoverLeaveTimerRef.current = null;
    }, 220);
  }, [cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    return () => {
      if (navigateFlashTimerRef.current !== null) window.clearTimeout(navigateFlashTimerRef.current);
      cancelProcessingPopoverLeaveTimer();
    };
  }, [cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    if (displayMode !== "cards") {
      cancelProcessingPopoverLeaveTimer();
      setProcessingPopoverSlotKey(null);
      setListProcessingSheetSlotKey(null);
    }
  }, [displayMode, cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const sync = () => setPrefersNoHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (listProcessingSheetSlotKey) {
        e.preventDefault();
        setListProcessingSheetSlotKey(null);
        return;
      }
      if (processingPopoverSlotKey) {
        e.preventDefault();
        cancelProcessingPopoverLeaveTimer();
        setProcessingPopoverSlotKey(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listProcessingSheetSlotKey, processingPopoverSlotKey, cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    persistDisplayMode(displayMode);
  }, [displayMode]);

  useEffect(() => {
    persistListProcessingHoverPopover(listProcessingHoverPopover);
  }, [listProcessingHoverPopover]);

  const toggleHighlightKey = useCallback((slotKey: string) => {
    setHighlightKeys((prev) => {
      const next = new Set(prev);
      if (next.has(slotKey)) next.delete(slotKey);
      else next.add(slotKey);
      persistHighlights(next);
      return next;
    });
  }, []);

  const clearAllHighlights = useCallback(() => {
    setHighlightKeys(new Set());
    persistHighlights(new Set());
  }, []);

  const scrollToSlotKey = useCallback((slotKey: string) => {
    const run = () => {
      const safe =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(slotKey)
          : slotKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-baggage-slot="${safe}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    };
    requestAnimationFrame(run);
  }, []);

  const handleSearchRowClick = useCallback(
    (dedupeKey: string) => {
      if (navigateFlashTimerRef.current !== null) {
        window.clearTimeout(navigateFlashTimerRef.current);
        navigateFlashTimerRef.current = null;
      }
      setNavigateFlashKey(dedupeKey);
      scrollToSlotKey(dedupeKey);
      navigateFlashTimerRef.current = window.setTimeout(() => {
        setNavigateFlashKey(null);
        navigateFlashTimerRef.current = null;
      }, NAVIGATE_FLASH_MS);
    },
    [scrollToSlotKey]
  );

  const visibleSlots = useMemo(() => {
    let list = excludeOutboundFlights(filterByTab(slots, activeTab));
    if (hideKeCodeshareFlights) {
      list = list.filter((slot) => shouldKeepSlotWithKeCodeshareFilter(slot.flight));
    }
    return collapseDuplicateFlightsPreferClassified(list);
  }, [slots, activeTab, hideKeCodeshareFlights]);

  const listSheetSlotItem = useMemo(() => {
    if (!listProcessingSheetSlotKey) return null;
    return visibleSlots.find((s) => getSlotDedupeKey(s) === listProcessingSheetSlotKey) ?? null;
  }, [listProcessingSheetSlotKey, visibleSlots]);

  useEffect(() => {
    if (!isMobileGridViewport || !isGridTableMode(displayMode)) return;
    const el = tablePinchWrapRef.current;
    if (!el) return;

    const touchDist = (e: TouchEvent) => {
      if (e.touches.length < 2) return 0;
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const d = touchDist(e);
        if (d > 1) pinchGestureRef.current = { dist0: d, zoom0: mobileGridZoomRef.current };
      }
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchGestureRef.current) return;
      const d = touchDist(e);
      if (d <= 1) return;
      const z = clampMobileGridZoom(
        pinchGestureRef.current.zoom0 * (d / pinchGestureRef.current.dist0)
      );
      e.preventDefault();
      setMobileGridZoom(z);
    };

    const onEnd = () => {
      pinchGestureRef.current = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [displayMode, isMobileGridViewport]);

  const byHourCarousel = useMemo(() => {
    const map = new Map<string, BaggageSlot[]>();
    for (const slot of visibleSlots) {
      const key = `${slot.hour}-${slot.carousel}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(compareSlotsByEstimatedArrival);
    }
    return map;
  }, [visibleSlots]);

  const searchRows = useMemo(() => {
    const q = keyword.trim().toUpperCase();
    if (!q) return [];
    const matches = visibleSlots
      .filter((slot) => slot.flight.toUpperCase().includes(q))
      .map((slot) => ({
        dedupeKey: getSlotDedupeKey(slot),
        sortMin: getSortableMinuteOfDay(slot),
        flight: slot.flight,
        hour: slot.hour,
        time: formatTime(slot.estimatedTime),
        carousel: slot.carousel,
      }));

    const unique = new Map<string, (typeof matches)[number]>();
    for (const row of matches) {
      if (!unique.has(row.dedupeKey)) unique.set(row.dedupeKey, row);
    }
    return [...unique.values()]
      .sort(
        (a, b) =>
          a.sortMin - b.sortMin ||
          a.carousel - b.carousel ||
          `${a.hour}-${a.flight}`.localeCompare(`${b.hour}-${b.flight}`)
      )
      .slice(0, 20);
  }, [keyword, visibleSlots]);

  const availableDates = useMemo(() => Object.keys(slotsByDate).sort(), [slotsByDate]);

  const cardSlotsByHour = useMemo(() => {
    const map = new Map<string, Map<string, BaggageSlot>>();
    for (const slot of visibleSlots) {
      const hour = slot.hour;
      let inner = map.get(hour);
      if (!inner) {
        inner = new Map();
        map.set(hour, inner);
      }
      inner.set(getSlotDedupeKey(slot), slot);
    }
    const out = new Map<string, BaggageSlot[]>();
    for (const [hour, inner] of map) {
      const list = [...inner.values()].sort(compareSlotsByEstimatedArrival);
      out.set(hour, list);
    }
    return out;
  }, [visibleSlots]);

  /** 목록에서 시간대 순 첫 카드 — 스티키 시간줄·상단바에 툴팁이 겹침 → 해당 카드만 툴팁을 아래로 살짝 이동 */
  const firstListCardSlotKey = useMemo(() => {
    for (const hour of hours) {
      const items = cardSlotsByHour.get(hour);
      if (!items?.length) {
        if (!LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) continue;
        continue;
      }
      return getSlotDedupeKey(items[0]!);
    }
    return null;
  }, [hours, cardSlotsByHour]);

  /** 격자: 마지막 행·모바일 줌이 홈 인디케이터 등에 가려지지 않게 스크롤 끝 여유 */
  const tableBottomScrollSpacerClass =
    isGridTableMode(displayMode) && isMobileGridViewport
      ? "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      : "";

  /**
   * 래퍼에 항상 `overflow-x-auto`만 두면 브라우저가 세로 스크롤 기준을 바꿔
   * `thead`의 `sticky top-0`이 페이지가 아니라 래퍼 기준으로 깨짐 → 노란 캐로셀 줄이 안 따라옴.
   * 모바일에서 확대로 가로가 넘칠 때만 가로 스크롤을 켜고 `overflow-y-clip`으로 세로 sticky는 유지.
   */
  const gridNeedsHorizontalScroll = isGridTableMode(displayMode) && mobileGridZoom > 1.001;
  const gridScaleStyle =
    isGridTableMode(displayMode) && Math.abs(mobileGridZoom - 1) >= 0.0001
      ? ({ transform: `scale(${mobileGridZoom})`, transformOrigin: "top left" } as CSSProperties)
      : undefined;

  return (
    <>
    <section className={`space-y-3 sm:space-y-4 ${tableBottomScrollSpacerClass}`}>
      <header className="space-y-6 sm:space-y-7">
        <div className="text-left">
          <h1 className="text-xl font-bold tracking-tight text-[#1e40af] sm:text-2xl">수하물 케로셀 현황판</h1>
          <p className="mt-2 text-sm text-slate-500">* API 자동 갱신 : 1분 간격</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]" />
            <span className="text-slate-500">LIVE</span>
            <span className="tabular-nums text-slate-700">
              {lastUpdated ? lastUpdated.toLocaleString("ko-KR", { hour12: false }) : "—"}
            </span>
          </div>
        </div>

        <div className="flex w-full max-w-xl flex-col gap-3">
        <div className={DASH_CARD} role="group" aria-label="화면 형식">
          <div className={DASH_ROW}>
            <span className={DASH_LABEL}>화면</span>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-start">
              <button type="button" onClick={() => setDisplayMode("table")} className={dashBtn(displayMode === "table")}>
                케로셀 현황
              </button>
              <button
                type="button"
                onClick={() => setDisplayMode("processing")}
                title="첫·마지막 수하물 벨트 도착 시각을 격자와 같은 표 형태로 봅니다."
                className={dashBtn(displayMode === "processing")}
              >
                수하물 처리 시간
              </button>
              <button type="button" onClick={() => setDisplayMode("cards")} className={dashBtn(displayMode === "cards")}>
                모바일
              </button>
            </div>
          </div>
        </div>

        <div className={DASH_CARD} role="group" aria-label="터미널">
          <div className={DASH_ROW}>
            <span className={DASH_LABEL}>터미널</span>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-start">
              {TAB_ITEMS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={dashBtn(activeTab === tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={DASH_CARD}>
          <div className={DASH_ROW}>
            <label htmlFor="date-select" className={DASH_LABEL}>
              날짜
            </label>
            <select
              id="date-select"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className={DASH_SELECT}
            >
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={DASH_CARD}>
          <div className={DASH_ROW}>
            <label htmlFor="flight-search" className={DASH_LABEL}>
              편명
            </label>
            <input
              id="flight-search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="편명 검색 (예 : KE714)"
              className={DASH_INPUT}
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          {!!keyword.trim() && (
            <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-700">
              {searchRows.length === 0 ? (
                <p className="text-slate-500">검색 결과가 없습니다.</p>
              ) : (
                <div className="space-y-1">
                  {searchRows.map((row) => (
                    <button
                      key={row.dedupeKey}
                      type="button"
                      onClick={() => handleSearchRowClick(row.dedupeKey)}
                      className={`min-h-[44px] w-full rounded-md px-2 py-2.5 text-left text-xs leading-snug transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400 sm:min-h-0 sm:px-1 sm:py-1 ${
                        navigateFlashKey === row.dedupeKey
                          ? "border-2 border-pink-500 bg-pink-200 text-slate-900 shadow-[inset_0_0_0_1px_rgba(236,72,153,0.35),0_0_12px_rgba(236,72,153,0.4)]"
                          : kePinkHighlight && isMainlineKeFlight(row.flight)
                            ? "border-2 border-transparent bg-blue-100 text-slate-900 hover:bg-blue-200/90"
                            : "border-2 border-transparent bg-transparent text-slate-700 hover:bg-slate-100/80"
                      }`}
                      aria-label={`${row.flight} 목록·격자·수하물 처리 시간에서 해당 위치로 이동`}
                    >
                      {row.flight} — 시간{" "}
                      <span className="font-bold tabular-nums text-slate-950">{row.time}</span> — 적재대{" "}
                      {row.carousel}번
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </div>

        {loading && (
          <p className="text-left text-sm font-medium text-[#1e40af]">데이터를 불러오는 중...</p>
        )}
        {error && <p className="text-left text-sm font-medium text-red-600">오류: {error}</p>}
        {refreshError && (
          <p className="text-left text-sm font-medium text-amber-800">
            갱신 실패(이전 데이터 표시): {refreshError}
          </p>
        )}
      </header>

      {displayMode === "cards" ? (
        <div
          className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm"
          style={{ ["--list-toolbar-h" as string]: LIST_STICKY_TOOLBAR_HEIGHT } as CSSProperties}
        >
          {visibleSlots.length > 0 ? (
            <div
              className={`sticky top-0 ${Z_LIST_TOOLBAR} flex min-h-[var(--list-toolbar-h)] items-center justify-end border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm sm:px-4`}
            >
              <button
                type="button"
                aria-pressed={listProcessingHoverPopover}
                title={
                  listProcessingHoverPopover
                    ? "항공편에 마우스를 올렸을 때 뜨는 수하물 처리 시간 창을 끕니다."
                    : "수하물 처리 시간 작은 창을 다시 표시합니다."
                }
                onClick={() => {
                  setListProcessingHoverPopover((prev) => {
                    const next = !prev;
                    if (!next) {
                      cancelProcessingPopoverLeaveTimer();
                      setProcessingPopoverSlotKey(null);
                      setListProcessingSheetSlotKey(null);
                    }
                    return next;
                  });
                }}
                className={`rounded-md border px-2.5 py-1.5 text-[10px] font-semibold leading-tight shadow-sm sm:px-3 sm:text-[11px] ${
                  listProcessingHoverPopover
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                처리 시간
              </button>
            </div>
          ) : null}
          <div className="p-3 sm:p-4">
            {visibleSlots.length === 0 ? (
              <EmptyState message="현재 운항 정보가 없습니다. 필터나 날짜를 확인해 주세요." />
            ) : (
              <div className="space-y-6 overflow-visible">
              {hours.map((hour) => {
                const items = cardSlotsByHour.get(hour);
                if (!items?.length && !LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) return null;
                return (
                  <section key={hour} className="overflow-visible pb-1">
                    <h2 className="sticky top-[var(--list-toolbar-h)] z-10 mb-2 border-b border-slate-200 bg-white/95 pb-1 text-base font-bold tabular-nums tracking-tight text-slate-950 backdrop-blur-sm sm:text-lg">
                      {hour}
                    </h2>
                    {!items?.length ? (
                      <p className="text-sm text-slate-500">이 시간대에 표시할 항공편이 없습니다.</p>
                    ) : (
                    <ul className="grid gap-2 overflow-visible sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item) => {
                        const slotKey = getSlotDedupeKey(item);
                        const highlighted = highlightKeys.has(slotKey);
                        const popoverOpen =
                          listProcessingHoverPopover && processingPopoverSlotKey === slotKey;
                        return (
                          <li key={slotKey} className="overflow-visible">
                            <article
                              data-baggage-slot={slotKey}
                              className={`relative flex items-center gap-1.5 overflow-visible rounded-lg border p-3 text-xs leading-relaxed text-slate-800 transition-[box-shadow,background-color] duration-200 ${popoverOpen ? Z_LIST_CARD_RAISED : "z-0"} ${slotShellClass(
                                highlighted,
                                item.flight,
                                kePinkHighlight,
                                isBagLastTimePassed(item, nowMs)
                              )} ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-900">
                                    적재대 {item.carousel}번
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    터미널 {getTerminal(item.raw) || "—"}
                                  </span>
                                </div>
                                <div
                                  className="relative min-w-0"
                                  onMouseEnter={
                                    prefersNoHover
                                      ? undefined
                                      : () => openProcessingPopover(slotKey)
                                  }
                                  onMouseLeave={prefersNoHover ? undefined : scheduleCloseProcessingPopover}
                                >
                                  <SlotDetail
                                    item={item}
                                    flightLineClassName={
                                      listProcessingHoverPopover && !prefersNoHover
                                        ? "cursor-help"
                                        : undefined
                                    }
                                  />
                                  {popoverOpen ? (
                                    <div
                                      className={`absolute bottom-full left-1/2 ${Z_LIST_HOVER_POPOVER} mb-2 w-max min-w-[14rem] max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl ring-1 ring-slate-900/10 ${
                                        slotKey === firstListCardSlotKey
                                          ? "translate-y-3 sm:translate-y-5"
                                          : ""
                                      }`}
                                      onMouseEnter={cancelProcessingPopoverLeaveTimer}
                                      onMouseLeave={scheduleCloseProcessingPopover}
                                      role="tooltip"
                                      aria-live="polite"
                                    >
                                      <p className="mb-2 border-b border-slate-100 pb-1.5 text-[11px] font-bold text-slate-900">
                                        수하물 처리 시간
                                      </p>
                                      <div className="text-xs leading-relaxed text-slate-800">
                                        <ProcessingSlotDetail item={item} />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-center gap-1 self-stretch sm:self-start">
                                {prefersNoHover && listProcessingHoverPopover ? (
                                  <button
                                    type="button"
                                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                                    aria-label="수하물 처리 시간 보기"
                                    title={
                                      hasBaggageProcessingTimes(item)
                                        ? "수하물 처리 시간"
                                        : "처리 시간 데이터 없음"
                                    }
                                    onClick={() => setListProcessingSheetSlotKey(slotKey)}
                                  >
                                    ⓘ
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => toggleHighlightKey(slotKey)}
                                  className={`self-center ${highlightMarkButtonClassList}`}
                                  aria-pressed={highlighted}
                                  aria-label={highlighted ? "강조 해제" : "강조 표시"}
                                  title={highlighted ? "강조 해제" : "강조 표시"}
                                >
                                  {highlighted ? "★" : "☆"}
                                </button>
                              </div>
                            </article>
                          </li>
                        );
                      })}
                    </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          </div>
        </div>
      ) : displayMode === "processing" ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {visibleSlots.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState message="현재 운항 정보가 없습니다. 필터나 날짜를 확인해 주세요." />
            </div>
          ) : (
            <>
              {isMobileGridViewport ? (
                <p className="border-b border-slate-200 bg-white px-3 py-2 text-[10px] leading-snug text-slate-500">
                  격자는 두 손가락으로 벌리거나 모아 확대·축소할 수 있어요.
                </p>
              ) : null}
              <div
                className={
                  gridNeedsHorizontalScroll
                    ? "w-full min-w-0 overflow-x-auto overflow-y-hidden [-webkit-overflow-scrolling:touch]"
                    : "w-full min-w-0"
                }
              >
                <div
                  ref={tablePinchWrapRef}
                  className="origin-top-left align-top w-full max-w-full min-w-0 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
                  style={gridScaleStyle}
                >
                  <CarouselDataGrid
                    hours={hours}
                    byHourCarousel={byHourCarousel}
                    carouselGuideVisible={carouselGuideVisible}
                    onToggleGuide={toggleCarouselGuide}
                    highlightKeys={highlightKeys}
                    navigateFlashKey={navigateFlashKey}
                    kePinkHighlight={kePinkHighlight}
                    toggleHighlightKey={toggleHighlightKey}
                    variant="processing"
                    renderCellContent={(item) => <ProcessingSlotDetail item={item} compact />}
                    slotShellClassFn={slotShellClass}
                    navigateFlashShellClass={navigateFlashShellClass}
                    nowMs={nowMs}
                    stickyHeader={Math.abs(mobileGridZoom - 1) < 0.0001}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {isMobileGridViewport ? (
            <p className="border-b border-slate-200 bg-white px-3 py-2 text-[10px] leading-snug text-slate-500">
              격자는 두 손가락으로 벌리거나 모아 확대·축소할 수 있어요.
            </p>
          ) : null}
          <div
            className={
              gridNeedsHorizontalScroll
                ? "w-full min-w-0 overflow-x-auto overflow-y-hidden [-webkit-overflow-scrolling:touch]"
                : "w-full min-w-0"
            }
          >
            <div
              ref={tablePinchWrapRef}
              className="origin-top-left align-top w-full max-w-full min-w-0 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
              style={gridScaleStyle}
            >
              <CarouselDataGrid
                hours={hours}
                byHourCarousel={byHourCarousel}
                carouselGuideVisible={carouselGuideVisible}
                onToggleGuide={toggleCarouselGuide}
                highlightKeys={highlightKeys}
                navigateFlashKey={navigateFlashKey}
                kePinkHighlight={kePinkHighlight}
                toggleHighlightKey={toggleHighlightKey}
                variant="schedule"
                renderCellContent={(item) => <SlotDetail item={item} compact />}
                slotShellClassFn={slotShellClass}
                navigateFlashShellClass={navigateFlashShellClass}
                nowMs={nowMs}
                stickyHeader={Math.abs(mobileGridZoom - 1) < 0.0001}
              />
            </div>
          </div>
        </div>
      )}

      {listSheetSlotItem && displayMode === "cards" ? (
        <div
          className={`fixed inset-0 ${Z_SHEET_BACKDROP} flex items-end justify-center bg-slate-900/45 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 sm:items-center sm:p-4`}
          role="presentation"
          onClick={() => setListProcessingSheetSlotKey(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-processing-sheet-title"
            className={`${Z_SHEET_PANEL} relative max-h-[min(85vh,32rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:rounded-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <p id="list-processing-sheet-title" className="text-base font-bold text-slate-900">
                수하물 처리 시간
              </p>
              <button
                type="button"
                className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setListProcessingSheetSlotKey(null)}
              >
                닫기
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {formatFlightAirportLine(listSheetSlotItem)} · 적재대 {listSheetSlotItem.carousel}번
            </p>
            {listSheetSlotItem.note === "fixedSchedule" && !hasBaggageProcessingTimes(listSheetSlotItem) ? (
              <p className="text-sm leading-relaxed text-slate-600">
                고정 스케줄(막바지 시간대) 행은 공공데이터에 첫·마지막 수하물 시각이 없습니다.
              </p>
            ) : (
              <div className="text-sm leading-relaxed">
                <ProcessingSlotDetail item={listSheetSlotItem} abbrevLegend />
              </div>
            )}
          </div>
        </div>
      ) : null}
      <p className="pt-1 text-center text-[10px] text-slate-400 sm:text-xs">
        인천국제공항공사 공공데이터 | 본 서비스는 비공식 개인 프로젝트이며, 제공되는 정보는 실제
        공항 상황과 차이가 있을 수 있으므로 참고용으로만 활용해 주시기 바랍니다.
      </p>
    </section>
    </>
  );
}
