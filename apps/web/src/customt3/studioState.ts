/* oxlint-disable t3code/no-untranslated-copy -- fork-only copy, English only */
export const STUDIO_STORAGE_KEY = "customt3:workspace-studio:v1";

export type StudioHeight = "compact" | "balanced" | "immersive";
export type StudioPresetKey = "aurora" | "ember" | "tide" | "graphite";

export interface StudioPreset {
  readonly name: string;
  readonly description: string;
  readonly accent: string;
  readonly colors: readonly [string, string, string];
}

export interface StudioSettings {
  readonly enabled: boolean;
  readonly preset: StudioPresetKey;
  readonly title: string;
  readonly subtitle: string;
  readonly image: string;
  readonly height: StudioHeight;
  readonly grain: boolean;
  readonly motion: boolean;
  readonly clock: boolean;
  readonly glow: boolean;
}

export const STUDIO_PRESETS: Readonly<Record<StudioPresetKey, StudioPreset>> = {
  aurora: {
    name: "Aurora",
    description: "Soft light, deep focus",
    accent: "#a5b4fc",
    colors: ["#182844", "#627bd1", "#83b8b0"],
  },
  ember: {
    name: "Ember",
    description: "A little golden hour",
    accent: "#fdba74",
    colors: ["#442537", "#bc7162", "#efbc7d"],
  },
  tide: {
    name: "Tide",
    description: "Room to think clearly",
    accent: "#67e8f9",
    colors: ["#0c3648", "#268f9b", "#9cd5cb"],
  },
  graphite: {
    name: "Graphite",
    description: "Quiet, by design",
    accent: "#d4d4d8",
    colors: ["#20212c", "#616675", "#a6a8b0"],
  },
};

export const STUDIO_DEFAULTS: StudioSettings = {
  enabled: true,
  preset: "aurora",
  title: "Make room for great work.",
  subtitle: "A little atmosphere. A lot of possibility.",
  image: "",
  height: "balanced",
  grain: true,
  motion: false,
  clock: false,
  glow: true,
};

const BOOLEAN_KEYS = ["enabled", "grain", "motion", "clock", "glow"] as const;
const HEIGHTS: readonly StudioHeight[] = ["compact", "balanced", "immersive"];
const MAX_IMAGE_LENGTH = 1_800_000;
const RASTER_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

function isPresetKey(value: unknown): value is StudioPresetKey {
  return typeof value === "string" && Object.hasOwn(STUDIO_PRESETS, value);
}

export function normalizeStudioSettings(value: unknown): StudioSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const next: { -readonly [K in keyof StudioSettings]: StudioSettings[K] } = { ...STUDIO_DEFAULTS };
  for (const key of BOOLEAN_KEYS) {
    const candidate = input[key];
    if (typeof candidate === "boolean") next[key] = candidate;
  }
  if (isPresetKey(input.preset)) next.preset = input.preset;
  if (HEIGHTS.includes(input.height as StudioHeight)) next.height = input.height as StudioHeight;
  if (typeof input.title === "string") next.title = input.title.slice(0, 80);
  if (typeof input.subtitle === "string") next.subtitle = input.subtitle.slice(0, 140);
  // Raster data only: no external requests, SVG, file paths or scriptable URLs.
  if (
    typeof input.image === "string" &&
    input.image.length <= MAX_IMAGE_LENGTH &&
    RASTER_DATA_URL.test(input.image)
  ) {
    next.image = input.image;
  }
  return next;
}

export function readStudioSettings(storage: Pick<Storage, "getItem">): StudioSettings {
  try {
    return normalizeStudioSettings(JSON.parse(storage.getItem(STUDIO_STORAGE_KEY) ?? "null"));
  } catch {
    return STUDIO_DEFAULTS;
  }
}
