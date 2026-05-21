/**
 * 브라우저 `sessionStorage`에만 쌓는 경량 감사 로그(최근 N건).
 * 서버 로그와 동일하지 않으며, 탭을 닫으면 사라집니다. 운영 감사가 필요하면 서버보내기·WAF 로그 등과 병행하세요.
 */
const STORAGE_KEY = "baggage-client-audit-v1";
const MAX_ENTRIES = 40;

export type ClientAuditEntry = {
  ts: number;
  action: string;
  detail: Record<string, unknown>;
};

export function appendClientAudit(
  entry: Omit<ClientAuditEntry, "ts"> & { ts?: number }
): void {
  if (typeof window === "undefined") return;
  try {
    const ts = entry.ts ?? Date.now();
    const row: ClientAuditEntry = { ts, action: entry.action, detail: entry.detail };
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const prev: ClientAuditEntry[] = (() => {
      if (!raw) return [];
      try {
        const p = JSON.parse(raw) as unknown;
        return Array.isArray(p) ? (p as ClientAuditEntry[]) : [];
      } catch {
        return [];
      }
    })();
    const next = [...prev, row].slice(-MAX_ENTRIES);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode
  }
}
