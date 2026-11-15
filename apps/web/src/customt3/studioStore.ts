import { useSyncExternalStore } from "react";

import {
  STUDIO_DEFAULTS,
  STUDIO_STORAGE_KEY,
  normalizeStudioSettings,
  readStudioSettings,
  type StudioSettings,
} from "./studioState";

const SAVE_FAILED_MESSAGE =
  "Could not save. Local storage may be full or unavailable. Your previous settings are still active.";

const listeners = new Set<() => void>();

function readLocalSettings(): StudioSettings {
  if (typeof window === "undefined") return STUDIO_DEFAULTS;
  try {
    return readStudioSettings(window.localStorage);
  } catch {
    return STUDIO_DEFAULTS;
  }
}

let settings = readLocalSettings();
let storageError = "";

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STUDIO_STORAGE_KEY && event.key !== null) return;
    settings = readLocalSettings();
    emit();
  });
}

export function updateStudioSettings(patch: Partial<StudioSettings>): boolean {
  const next = normalizeStudioSettings({ ...settings, ...patch });
  try {
    window.localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(next));
    storageError = "";
    settings = next;
    emit();
    return true;
  } catch {
    storageError = SAVE_FAILED_MESSAGE;
    emit();
    return false;
  }
}

export function useStudioSettings(): StudioSettings {
  return useSyncExternalStore(
    subscribe,
    () => settings,
    () => STUDIO_DEFAULTS,
  );
}

export function useStudioStorageError(): string {
  return useSyncExternalStore(
    subscribe,
    () => storageError,
    () => "",
  );
}
