import { describe, expect, it } from "vite-plus/test";

import {
  STUDIO_DEFAULTS,
  STUDIO_STORAGE_KEY,
  normalizeStudioSettings,
  readStudioSettings,
} from "./studioState";

describe("normalizeStudioSettings", () => {
  it("falls back to defaults for invalid input and rejects unsafe images", () => {
    expect(normalizeStudioSettings(null)).toEqual(STUDIO_DEFAULTS);
    expect(normalizeStudioSettings([])).toEqual(STUDIO_DEFAULTS);
    const next = normalizeStudioSettings({
      preset: "nope",
      height: "huge",
      grain: "yes",
      title: "x".repeat(200),
      image: "https://example.com/a.png",
    });
    expect(next.preset).toBe(STUDIO_DEFAULTS.preset);
    expect(next.height).toBe(STUDIO_DEFAULTS.height);
    expect(next.grain).toBe(STUDIO_DEFAULTS.grain);
    expect(next.title).toHaveLength(80);
    expect(next.image).toBe("");
  });

  it("keeps valid values including raster data urls", () => {
    const image = "data:image/webp;base64,AAAA";
    expect(
      normalizeStudioSettings({ preset: "ember", height: "compact", clock: true, image }),
    ).toMatchObject({ preset: "ember", height: "compact", clock: true, image });
  });

  it("reads stored settings and survives broken storage", () => {
    const storage = {
      getItem: (key: string) => (key === STUDIO_STORAGE_KEY ? '{"preset":"tide"}' : null),
    };
    expect(readStudioSettings(storage).preset).toBe("tide");
    expect(readStudioSettings({ getItem: () => "{bad" })).toEqual(STUDIO_DEFAULTS);
  });
});
