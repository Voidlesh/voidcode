import { useSyncExternalStore } from "react";

export const INLINE_CODE_COLOR_STORAGE_KEY = "t3code:inline-code-color";
const INLINE_CODE_COLOR_CSS_VARIABLE = "--inline-code-color";

/** Claude's orange, offered as a one-click preset in Settings. */
export const CLAUDE_ORANGE_HEX = "#D97757";

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Returns a normalised `#rrggbb` string, or null when the input is not a hex colour. */
export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_PATTERN.test(withHash)) return null;
  const digits = withHash.slice(1).toLowerCase();
  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return `#${expanded}`;
}

/** The stored colour, or null so the theme's own text colour (white in dark themes) stays. */
export function readInlineCodeColor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INLINE_CODE_COLOR_STORAGE_KEY);
    return raw === null ? null : normalizeHexColor(raw);
  } catch {
    return null;
  }
}

function applyInlineCodeColor(color: string | null): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  if (color === null) {
    style.removeProperty(INLINE_CODE_COLOR_CSS_VARIABLE);
  } else {
    style.setProperty(INLINE_CODE_COLOR_CSS_VARIABLE, color);
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pass null to go back to the theme colour. Returns false when the value is invalid or storage fails. */
export function writeInlineCodeColor(color: string | null): boolean {
  if (typeof window === "undefined") return false;
  const normalized = color === null ? null : normalizeHexColor(color);
  if (color !== null && normalized === null) return false;
  try {
    if (normalized === null) {
      window.localStorage.removeItem(INLINE_CODE_COLOR_STORAGE_KEY);
    } else {
      window.localStorage.setItem(INLINE_CODE_COLOR_STORAGE_KEY, normalized);
    }
  } catch {
    return false;
  }
  applyInlineCodeColor(normalized);
  for (const listener of listeners) listener();
  return true;
}

export function useInlineCodeColor(): string | null {
  return useSyncExternalStore(subscribe, readInlineCodeColor, () => null);
}

if (typeof document !== "undefined") {
  applyInlineCodeColor(readInlineCodeColor());
}
