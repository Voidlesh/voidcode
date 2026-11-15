export const CLAUDE_LOOK_STORAGE_KEY = "t3code:claude-look";

/** Off by default so the current look stays unchanged until someone opts in. */
export const CLAUDE_LOOK_DEFAULT_ENABLED = false;

export function readClaudeLook(): boolean {
  if (typeof window === "undefined") return CLAUDE_LOOK_DEFAULT_ENABLED;
  try {
    const raw = window.localStorage.getItem(CLAUDE_LOOK_STORAGE_KEY);
    return raw === null ? CLAUDE_LOOK_DEFAULT_ENABLED : raw === "true";
  } catch {
    return CLAUDE_LOOK_DEFAULT_ENABLED;
  }
}

export function writeClaudeLook(enabled: boolean): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(CLAUDE_LOOK_STORAGE_KEY, enabled ? "true" : "false");
    return true;
  } catch {
    return false;
  }
}
