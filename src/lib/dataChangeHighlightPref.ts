export const DATA_CHANGE_HIGHLIGHT_STORAGE_KEY = "baggage-data-change-highlight-v1";

export function loadDataChangeHighlight(storage: Storage = localStorage): boolean {
  try {
    const raw = storage.getItem(DATA_CHANGE_HIGHLIGHT_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return true;
}

export function saveDataChangeHighlight(enabled: boolean, storage: Storage = localStorage): void {
  try {
    storage.setItem(DATA_CHANGE_HIGHLIGHT_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

/** UI: 변경 강조가 켜져 있을 때만 노란 펄스·배지 클래스/표시 여부 */
export function shouldShowDataChangeHighlight(
  dataChangeHighlight: boolean,
  slotKey: string,
  recentlyChangedKeys: Set<string>
): boolean {
  return dataChangeHighlight && recentlyChangedKeys.has(slotKey);
}
