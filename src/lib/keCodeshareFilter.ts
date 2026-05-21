/**
 * IATA 2자 + 숫자 4자리는 코드셰어 표기로 보고 숨김.(7C·KE 등 — `7C`는 앞이 숫자라 [A-Z]{2}로는 잡히지 않음)
 * 예외: KE + 4자리 + 천의 자리 2·8(본편 구간) 또는 9(차터, KE9xxx)만 유지.
 * 3자리·5자리 이상·패턴이 다른 편명은 그대로 둔다.
 */
export function shouldKeepSlotWithKeCodeshareFilter(flight: string): boolean {
  const compact = flight.trim().toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!m) return true;
  const carrier = m[1];
  const digits = m[2];
  if (digits.length !== 4) return true;
  if (carrier === "KE" && (digits[0] === "2" || digits[0] === "8" || digits[0] === "9")) return true;
  return false;
}
