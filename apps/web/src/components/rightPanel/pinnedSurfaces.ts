import * as Schema from "effect/Schema";

import type { RightPanelSurface } from "~/rightPanelStore";

// Same key and format as the original customt3 patch, so existing settings carry over.
export const PINNED_SURFACES_STORAGE_KEY = "customt3-pinned-surfaces";
export const DEFAULT_PINNED_SURFACES: readonly string[] = ["browser", "terminal"];
export const pinnedSurfacesSchema = Schema.Array(Schema.String);

export function sanitizePinnedSurfaces(stored: readonly unknown[]): string[] {
  return stored.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function surfaceKeyForLabel(label: string): string {
  return label.toLowerCase();
}

const SURFACE_KEY_BY_KIND: Partial<Record<RightPanelSurface["kind"], string>> = {
  preview: "browser",
  file: "files",
  "pull-request": "pull request",
  "pull-requests": "linked pull requests",
};

export function surfaceKeyForKind(kind: RightPanelSurface["kind"]): string {
  return SURFACE_KEY_BY_KIND[kind] ?? kind;
}

export function isSurfacePinned(pinned: readonly string[], key: string): boolean {
  return pinned.includes(key);
}

export function toggleSurfacePinned(pinned: readonly string[], key: string): string[] {
  return isSurfacePinned(pinned, key) ? pinned.filter((item) => item !== key) : [...pinned, key];
}

export function pinnedSurfaceActions<T extends { readonly label: string }>(
  actions: readonly T[],
  pinned: readonly string[],
): T[] {
  return actions.filter((action) => isSurfacePinned(pinned, surfaceKeyForLabel(action.label)));
}
