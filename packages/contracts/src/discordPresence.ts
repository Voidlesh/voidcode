export type DiscordActivityKind =
  | "working"
  | "connecting"
  | "approval"
  | "input"
  | "done"
  | "failed"
  | "stopped"
  | "ready"
  | "editing"
  | "thinking"
  | "writing"
  | "searching"
  | "command"
  | "tool"
  | "delegating"
  | "compacting"
  | "waiting"
  | "settings"
  | "browsing"
  | "idle"
  | "background";

export type DiscordAgentName = "Claude" | "Codex" | "Gemini" | "Cursor" | "Agent";

export interface DiscordPresenceConfig {
  enabled: boolean;
  clientId: string;
  mode: "auto" | "custom";
  detailsTemplate: string;
  stateTemplate: string;
  customActivity: string;
  showProject: boolean;
  showThread: boolean;
  showElapsed: boolean;
  idleMinutes: number;
  largeImage: string;
  largeText: string;
  smallImage: string;
  smallText: string;
  buttonLabel: string;
  buttonUrl: string;
  secondButtonLabel: string;
  secondButtonUrl: string;
}

export interface DiscordActivityContext {
  activity: DiscordActivityKind;
  project: string;
  thread: string;
  agent: DiscordAgentName;
  threads: number;
}

/** Window and system state that the main process observes; the renderer cannot report it. */
export interface DiscordPresenceState {
  idle?: boolean;
  background?: boolean;
}

export interface DiscordActivity {
  details: string;
  instance: false;
  state?: string;
  timestamps?: { start: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  buttons?: Array<{ label: string; url: string }>;
}

export interface DiscordPresenceSnapshot {
  config: DiscordPresenceConfig;
  status: string;
  context: DiscordActivityContext;
  presence: DiscordPresenceState;
  activity: DiscordActivity;
  startedAt: number;
}

export interface DesktopDiscordPresenceBridge {
  get: () => Promise<DiscordPresenceSnapshot>;
  save: (config: DiscordPresenceConfig) => Promise<DiscordPresenceSnapshot>;
  reportContext: (context: DiscordActivityContext) => Promise<void>;
}
