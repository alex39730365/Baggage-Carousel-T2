import { describe, expect, it, beforeEach } from "vitest";
import {
  DATA_CHANGE_HIGHLIGHT_STORAGE_KEY,
  loadDataChangeHighlight,
  saveDataChangeHighlight,
  shouldShowDataChangeHighlight,
} from "./dataChangeHighlightPref";

describe("dataChangeHighlightPref", () => {
  let storage: Storage;

  beforeEach(() => {
    const map = new Map<string, string>();
    storage = {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k) => map.get(k) ?? null,
      key: (i) => [...map.keys()][i] ?? null,
      removeItem: (k) => {
        map.delete(k);
      },
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  });

  it("defaults to true when unset", () => {
    expect(loadDataChangeHighlight(storage)).toBe(true);
  });

  it("persists off and on", () => {
    saveDataChangeHighlight(false, storage);
    expect(storage.getItem(DATA_CHANGE_HIGHLIGHT_STORAGE_KEY)).toBe("0");
    expect(loadDataChangeHighlight(storage)).toBe(false);

    saveDataChangeHighlight(true, storage);
    expect(loadDataChangeHighlight(storage)).toBe(true);
  });

  it("shouldShowDataChangeHighlight gates flash by pref and keys", () => {
    const keys = new Set(["slot-a"]);
    expect(shouldShowDataChangeHighlight(true, "slot-a", keys)).toBe(true);
    expect(shouldShowDataChangeHighlight(false, "slot-a", keys)).toBe(false);
    expect(shouldShowDataChangeHighlight(true, "slot-b", keys)).toBe(false);
    expect(shouldShowDataChangeHighlight(false, "slot-b", keys)).toBe(false);
  });
});
