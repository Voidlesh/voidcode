import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  INLINE_CODE_COLOR_STORAGE_KEY,
  normalizeHexColor,
  readInlineCodeColor,
  writeInlineCodeColor,
} from "./inlineCodeColor";

function stubLocalStorage(storage: {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}): void {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeHexColor", () => {
  it.each([
    ["#D97757", "#d97757"],
    ["d97757", "#d97757"],
    ["  #FA0 ", "#ffaa00"],
    ["#12345", null],
    ["orange", null],
    ["", null],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeHexColor(input)).toBe(expected);
  });
});

describe("inline code colour storage", () => {
  it("keeps the theme colour when nothing valid is stored", () => {
    stubLocalStorage({ getItem: () => null });
    expect(readInlineCodeColor()).toBeNull();
    stubLocalStorage({ getItem: () => "not-a-colour" });
    expect(readInlineCodeColor()).toBeNull();
  });

  it("falls back to the theme colour when storage throws", () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(readInlineCodeColor()).toBeNull();
  });

  it("stores the normalised colour under the boot-readable key and clears it on null", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    stubLocalStorage({ setItem, removeItem });
    expect(writeInlineCodeColor("D97757")).toBe(true);
    expect(setItem).toHaveBeenCalledWith(INLINE_CODE_COLOR_STORAGE_KEY, "#d97757");
    expect(writeInlineCodeColor(null)).toBe(true);
    expect(removeItem).toHaveBeenCalledWith(INLINE_CODE_COLOR_STORAGE_KEY);
  });

  it("rejects an invalid colour without writing", () => {
    const setItem = vi.fn();
    stubLocalStorage({ setItem });
    expect(writeInlineCodeColor("nope")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of throwing", () => {
    stubLocalStorage({
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(writeInlineCodeColor("#d97757")).toBe(false);
  });
});
