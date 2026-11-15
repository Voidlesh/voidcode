import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  BUILT_IN_THEMES,
  CLAUDE_LOOK_THEME,
  CLAUDE_LOOK_THEME_ID,
  RESERVED_THEME_IDS,
  THEME_COLOR_ROLES,
} from "@t3tools/shared/themePalettes";

import {
  CLAUDE_LOOK_DEFAULT_ENABLED,
  CLAUDE_LOOK_STORAGE_KEY,
  readClaudeLook,
  writeClaudeLook,
} from "./claudeLook";

function stubLocalStorage(storage: {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}): void {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claude look storage", () => {
  it("is off by default when nothing is stored", () => {
    stubLocalStorage({ getItem: () => null });
    expect(readClaudeLook()).toBe(CLAUDE_LOOK_DEFAULT_ENABLED);
    expect(CLAUDE_LOOK_DEFAULT_ENABLED).toBe(false);
  });

  it("reads only the exact string true as enabled", () => {
    stubLocalStorage({ getItem: (key) => (key === CLAUDE_LOOK_STORAGE_KEY ? "true" : null) });
    expect(readClaudeLook()).toBe(true);
    stubLocalStorage({ getItem: () => "false" });
    expect(readClaudeLook()).toBe(false);
  });

  it("falls back to the default when storage throws", () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(readClaudeLook()).toBe(false);
  });

  it("reports a failed write instead of throwing", () => {
    stubLocalStorage({
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(writeClaudeLook(true)).toBe(false);
  });

  it("writes true and false as strings under the boot-readable key", () => {
    const setItem = vi.fn();
    stubLocalStorage({ setItem });
    expect(writeClaudeLook(true)).toBe(true);
    expect(writeClaudeLook(false)).toBe(true);
    expect(setItem).toHaveBeenNthCalledWith(1, "t3code:claude-look", "true");
    expect(setItem).toHaveBeenNthCalledWith(2, "t3code:claude-look", "false");
  });
});

describe("claude palette", () => {
  it("defines every theme colour role for light and dark", () => {
    for (const role of THEME_COLOR_ROLES) {
      expect(CLAUDE_LOOK_THEME.colors[role], `light ${role}`).toMatch(/^#|oklch|rgb/);
      expect(CLAUDE_LOOK_THEME.variants?.dark?.[role], `dark ${role}`).toMatch(/^#|oklch|rgb/);
    }
  });

  it("stays out of the pickers but reserves its id", () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).not.toContain(CLAUDE_LOOK_THEME_ID);
    expect(RESERVED_THEME_IDS.has(CLAUDE_LOOK_THEME_ID)).toBe(true);
  });
});
