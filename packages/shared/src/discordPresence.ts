import type {
  DiscordActivity,
  DiscordActivityContext,
  DiscordActivityKind,
  DiscordAgentName,
  DiscordPresenceConfig,
  DiscordPresenceState,
} from "@t3tools/contracts";

export type {
  DiscordActivity,
  DiscordActivityContext,
  DiscordActivityKind,
  DiscordAgentName,
  DiscordPresenceConfig,
  DiscordPresenceSnapshot,
  DiscordPresenceState,
} from "@t3tools/contracts";

export const DISCORD_ARTWORK = Object.freeze({
  t3: "https://t3.codes/apple-touch-icon.png",
  essentials:
    "https://cdn.discordapp.com/app-icons/878349344737222696/fc2e1bc3b2eddbc40c6b8d56122349d7.png?size=512",
});

export const DISCORD_PRESENCE_DEFAULTS: Readonly<DiscordPresenceConfig> = Object.freeze({
  enabled: true,
  clientId: "878349344737222696",
  mode: "auto",
  detailsTemplate: "{activity}",
  stateTemplate: "{project}",
  customActivity: "Building something great",
  showProject: true,
  showThread: false,
  showElapsed: true,
  idleMinutes: 5,
  largeImage: DISCORD_ARTWORK.t3,
  largeText: "My custom T3 workspace",
  smallImage: DISCORD_ARTWORK.essentials,
  smallText: "{activity}",
  buttonLabel: "",
  buttonUrl: "",
  secondButtonLabel: "",
  secondButtonUrl: "",
});

const DISCORD_ACTIVITY_LABELS: Readonly<Record<DiscordActivityKind, string>> = Object.freeze({
  working: "Agent is working",
  connecting: "Starting an agent",
  approval: "Waiting for approval",
  input: "Waiting for input",
  done: "Ready for the next idea",
  failed: "Reviewing an issue",
  stopped: "Planning the next step",
  ready: "Working on a project",
  editing: "Editing files",
  thinking: "Thinking through the next step",
  writing: "Writing a response",
  searching: "Searching for information",
  command: "Running a command",
  tool: "Using a tool",
  delegating: "Working with subagents",
  compacting: "Compacting the context",
  waiting: "Waiting for background work",
  settings: "Customizing the workspace",
  browsing: "Exploring the workspace",
  idle: "Taking a break",
  background: "Workspace running in background",
});

// Running work stays visible even when the window is hidden or the user is away.
const BUSY_ACTIVITIES: ReadonlySet<DiscordActivityKind> = new Set([
  "working",
  "connecting",
  "approval",
  "input",
  "thinking",
  "writing",
  "searching",
  "command",
  "tool",
  "delegating",
  "compacting",
  "editing",
  "waiting",
]);

const KNOWN_AGENTS: ReadonlyArray<DiscordAgentName> = ["Claude", "Codex", "Gemini", "Cursor"];
const CLIENT_ID_PATTERN = /^\d{17,20}$/;
const ASSET_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function cleanText(value: unknown, fallback = "", max = 128): string {
  return typeof value === "string"
    ? Array.from(value.replace(CONTROL_CHARACTERS, " ").trim()).slice(0, max).join("")
    : fallback;
}

export function publicUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function cleanImage(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  const text = cleanText(value, "", 512);
  return publicUrl(text) || (ASSET_KEY_PATTERN.test(text) ? text : "");
}

const BOOLEAN_KEYS = ["enabled", "showProject", "showThread", "showElapsed"] as const;
const TEXT_KEYS = [
  "detailsTemplate",
  "stateTemplate",
  "customActivity",
  "largeText",
  "smallText",
] as const;
const IMAGE_KEYS = ["largeImage", "smallImage"] as const;
const LABEL_KEYS = ["buttonLabel", "secondButtonLabel"] as const;
const URL_KEYS = ["buttonUrl", "secondButtonUrl"] as const;

export function normalizeDiscordPresenceConfig(value?: unknown): DiscordPresenceConfig {
  const input = asRecord(value);
  const next: DiscordPresenceConfig = { ...DISCORD_PRESENCE_DEFAULTS };
  const clientId = input.clientId ?? DISCORD_PRESENCE_DEFAULTS.clientId;
  next.clientId = typeof clientId === "string" && CLIENT_ID_PATTERN.test(clientId) ? clientId : "";
  for (const key of BOOLEAN_KEYS) {
    const flag = input[key];
    if (typeof flag === "boolean") next[key] = flag;
  }
  next.mode = input.mode === "custom" ? "custom" : "auto";
  if (typeof input.idleMinutes === "number" && Number.isFinite(input.idleMinutes)) {
    next.idleMinutes = Math.max(1, Math.min(60, Math.round(input.idleMinutes)));
  }
  for (const key of TEXT_KEYS) next[key] = cleanText(input[key], DISCORD_PRESENCE_DEFAULTS[key]);
  for (const key of IMAGE_KEYS) next[key] = cleanImage(input[key], DISCORD_PRESENCE_DEFAULTS[key]);
  for (const key of LABEL_KEYS) next[key] = cleanText(input[key], "", 32);
  for (const key of URL_KEYS) next[key] = publicUrl(input[key]);
  return next;
}

export function normalizeDiscordActivityContext(value?: unknown): DiscordActivityContext {
  const input = asRecord(value);
  const { activity, agent, threads } = input;
  return {
    activity:
      typeof activity === "string" && Object.hasOwn(DISCORD_ACTIVITY_LABELS, activity)
        ? (activity as DiscordActivityKind)
        : "browsing",
    project: cleanText(input.project, "", 80),
    thread: cleanText(input.thread, "", 100),
    agent: KNOWN_AGENTS.find((known) => known === agent) ?? "Agent",
    threads:
      typeof threads === "number" && Number.isFinite(threads)
        ? Math.max(0, Math.min(999, Math.floor(threads)))
        : 0,
  };
}

function renderTemplate(
  template: string,
  config: DiscordPresenceConfig,
  context: DiscordActivityContext,
  activity: string,
): string {
  const tokens: Record<string, string> = {
    activity,
    project: config.showProject && context.project ? context.project : "T3 Code",
    thread: config.showThread && context.thread ? context.thread : "Private thread",
    threads: String(context.threads),
    agent: context.agent,
  };
  return cleanText(
    template.replace(
      /\{(activity|project|thread|threads|agent)\}/g,
      (_, key: string) => tokens[key] ?? "",
    ),
  );
}

export function createDiscordActivity(
  config: unknown,
  context: unknown,
  startedAt: number,
  { idle = false, background = false }: DiscordPresenceState = {},
): DiscordActivity {
  const c = normalizeDiscordPresenceConfig(config);
  const ctx = normalizeDiscordActivityContext(context);
  const busy = BUSY_ACTIVITIES.has(ctx.activity);
  const shown: DiscordActivityKind = busy
    ? ctx.activity
    : idle
      ? "idle"
      : background
        ? "background"
        : ctx.activity;
  const activity = c.mode === "custom" ? c.customActivity : DISCORD_ACTIVITY_LABELS[shown];
  const render = (template: string) => renderTemplate(template, c, ctx, activity);
  const result: DiscordActivity = {
    details: render(c.detailsTemplate) || activity || "T3 Code",
    instance: false,
  };
  const state = render(c.stateTemplate);
  if (state) result.state = state;
  if (c.showElapsed) result.timestamps = { start: startedAt };
  const assets: NonNullable<DiscordActivity["assets"]> = {};
  if (c.largeImage) {
    assets.large_image = c.largeImage;
    assets.large_text = render(c.largeText) || "T3 Code";
  }
  if (c.smallImage) {
    assets.small_image = c.smallImage;
    assets.small_text = render(c.smallText) || "T3 Code";
  }
  if (Object.keys(assets).length > 0) result.assets = assets;
  const buttons = [
    { label: c.buttonLabel, url: c.buttonUrl },
    { label: c.secondButtonLabel, url: c.secondButtonUrl },
  ].filter((button) => button.label && button.url);
  if (buttons.length > 0) result.buttons = buttons;
  return result;
}
