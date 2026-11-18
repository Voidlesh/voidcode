/* oxlint-disable t3code/no-untranslated-copy -- fork-only copy, English only */
import type {
  DiscordActivityContext,
  DiscordPresenceConfig,
  DiscordPresenceSnapshot,
} from "@t3tools/contracts";
import {
  DISCORD_ARTWORK,
  DISCORD_PRESENCE_DEFAULTS,
  createDiscordActivity,
  publicUrl,
} from "@t3tools/shared/discordPresence";
import { useEffect, useId, useRef, useState } from "react";
import { useNowSecond } from "~/hooks/useNowSecond";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";

import "./studio.css";
import "./discord.css";

const REFRESH_INTERVAL_MS = 2000;
const SAVED_HINT_MS = 3000;
const IDLE_MINUTE_OPTIONS = [1, 5, 10, 15, 30, 60];
const ASSET_KEY = /^[a-zA-Z0-9_-]{1,128}$/;
const CLIENT_ID = /^\d{17,20}$/;
const TOKENS = ["{activity}", "{project}", "{thread}", "{threads}", "{agent}"];

const STYLE_PRESETS: ReadonlyArray<{
  name: string;
  description: string;
  patch: Partial<DiscordPresenceConfig>;
}> = [
  {
    name: "Workspace",
    description: "Your real activity and project",
    patch: {
      mode: "auto",
      detailsTemplate: "{activity}",
      stateTemplate: "{project}",
      showProject: true,
      showThread: false,
      largeImage: DISCORD_ARTWORK.t3,
      smallImage: DISCORD_ARTWORK.essentials,
    },
  },
  {
    name: "Essentials",
    description: "Your brand, your workspace",
    patch: {
      mode: "auto",
      detailsTemplate: "{activity}",
      stateTemplate: "{project} · {threads} active",
      showProject: true,
      showThread: false,
      largeImage: DISCORD_ARTWORK.essentials,
      smallImage: DISCORD_ARTWORK.t3,
    },
  },
  {
    name: "Quiet focus",
    description: "Activity, with names kept private",
    patch: {
      mode: "auto",
      detailsTemplate: "{activity}",
      stateTemplate: "Making room for great work",
      showProject: false,
      showThread: false,
      largeImage: DISCORD_ARTWORK.t3,
      smallImage: "",
    },
  },
];

type Scenario = "live" | "working" | "idle";
type TextKey = {
  [K in keyof DiscordPresenceConfig]: DiscordPresenceConfig[K] extends string ? K : never;
}[keyof DiscordPresenceConfig];
type BooleanKey = {
  [K in keyof DiscordPresenceConfig]: DiscordPresenceConfig[K] extends boolean ? K : never;
}[keyof DiscordPresenceConfig];

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

function validate(draft: DiscordPresenceConfig): string {
  if (!CLIENT_ID.test(draft.clientId)) {
    return "Enter a valid public Discord Application ID (17–20 digits).";
  }
  for (const key of ["largeImage", "smallImage"] as const) {
    const value = draft[key].trim();
    if (value && !publicUrl(value) && !ASSET_KEY.test(value)) {
      return "Images need a public HTTPS URL or a Discord asset key.";
    }
  }
  const buttons = [
    [draft.buttonLabel, draft.buttonUrl],
    [draft.secondButtonLabel, draft.secondButtonUrl],
  ] as const;
  for (const [label, url] of buttons) {
    if (Boolean(label.trim()) !== Boolean(url.trim())) {
      return "Each button needs both a label and a public HTTPS link.";
    }
    if (url && !publicUrl(url))
      return "Button links must use HTTPS without a username or password.";
  }
  return "";
}

function Artwork({
  source,
  small = false,
}: {
  readonly source?: string | undefined;
  readonly small?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === source;
  return (
    <span className={small ? "rpc-small-art" : "rpc-large-art"}>
      {source && publicUrl(source) && !failed ? (
        <img
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span />}>{small ? "✦" : "T3"}</TooltipTrigger>
          <TooltipPopup>
            {source ? "Discord asset key, visible in Discord" : "No image"}
          </TooltipPopup>
        </Tooltip>
      )}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  placeholder,
  maxLength = 128,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="rpc-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className="rpc-switch-row">
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        className="ct3-toggle"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function DiscordSettingsPanel() {
  const [draft, setDraft] = useState<DiscordPresenceConfig | null>(null);
  const [live, setLive] = useState<DiscordPresenceSnapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("live");
  const [resetArmed, setResetArmed] = useState(false);
  const dirtyRef = useRef(false);
  const editVersion = useRef(0);
  const mounted = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the desktop main process for live presence state
  useEffect(() => {
    mounted.current = true;
    let timer: number | undefined;
    let active = true;
    const refresh = async () => {
      const version = editVersion.current;
      const bridge = window.desktopBridge?.discordPresence;
      if (!bridge) {
        if (active) setError("Discord settings are available in the T3 desktop app.");
      } else {
        try {
          const result = await bridge.get();
          if (active) {
            setLive(result);
            if (!dirtyRef.current && version === editVersion.current) setDraft(result.config);
          }
        } catch (cause) {
          if (active) setError(errorMessage(cause));
        }
      }
      if (active) timer = window.setTimeout(() => void refresh(), REFRESH_INTERVAL_MS);
    };
    void refresh();
    return () => {
      active = false;
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the transient "saved" hint on a timer
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), SAVED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const patch = (change: Partial<DiscordPresenceConfig>) => {
    editVersion.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaved(false);
    setError("");
    setDraft((previous) => (previous ? { ...previous, ...change } : previous));
  };

  const save = async () => {
    const bridge = window.desktopBridge?.discordPresence;
    if (!draft || !bridge) return;
    const message = validate(draft);
    if (message) {
      setError(message);
      return;
    }
    const version = editVersion.current;
    setSaving(true);
    setError("");
    try {
      const result = await bridge.save(draft);
      if (mounted.current) {
        setLive(result);
        if (version === editVersion.current) {
          editVersion.current += 1;
          setDraft(result.config);
          dirtyRef.current = false;
          setDirty(false);
          setSaved(true);
        }
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    }
    if (mounted.current) setSaving(false);
  };

  const textField = (
    key: TextKey,
    label: string,
    options: { hint?: string; placeholder?: string; maxLength?: number } = {},
  ) =>
    draft ? (
      <Field
        key={key}
        label={label}
        value={draft[key]}
        onChange={(value) => patch({ [key]: value })}
        {...options}
      />
    ) : null;

  const toggle = (key: BooleanKey, label: string, hint: string) =>
    draft ? (
      <Switch
        key={key}
        label={label}
        hint={hint}
        checked={draft[key]}
        onChange={(value) => patch({ [key]: value })}
      />
    ) : null;

  const status = live?.status ?? "Loading";
  const nowSeconds = Math.floor(useNowSecond() / 1000);
  const startedAt = live?.startedAt ?? nowSeconds;
  const scenarioContext: DiscordActivityContext | undefined =
    scenario === "live"
      ? live?.context
      : {
          activity: scenario === "idle" ? "browsing" : "working",
          project: "customt3",
          thread: "Building a better workspace",
          threads: 2,
          agent: "Agent",
        };
  const activity = draft
    ? createDiscordActivity(
        draft,
        scenarioContext,
        startedAt,
        scenario === "live" ? live?.presence : { idle: scenario === "idle" },
      )
    : null;
  const isDefaultApplication = draft?.clientId === DISCORD_PRESENCE_DEFAULTS.clientId;

  return (
    <div className="rpc-scroll">
      <section id="discord-presence" className="rpc-settings" aria-labelledby="rpc-title">
        <header className="rpc-header">
          <div>
            <div className="rpc-eyebrow">YOUR WORK. YOUR PRESENCE.</div>
            <h1 id="rpc-title">Discord Rich Presence</h1>
            <p>A little window into what you’re making. Entirely yours.</p>
          </div>
          <span className="rpc-connection" data-connected={status === "Connected"} role="status">
            <i />
            {status}
          </span>
        </header>
        {error ? (
          <p className="rpc-error" role="alert">
            {error}
          </p>
        ) : null}
        {!draft || !activity ? (
          <p role="status">
            {error ? "Your saved presence has not been changed." : "Loading your presence…"}
          </p>
        ) : (
          <div className="rpc-layout">
            <div className="rpc-editor">
              <div className="rpc-panel">
                {toggle(
                  "enabled",
                  "Share your presence",
                  "Show this activity on your Discord profile.",
                )}
                <div className="rpc-form-body">
                  {textField("clientId", "Application ID", {
                    maxLength: 20,
                    hint: "Public ID only. The app name is managed in the Discord Developer Portal.",
                  })}
                  <p className="rpc-caption">
                    {isDefaultApplication
                      ? "This application is currently named Essentials in Discord."
                      : "Your application’s name will appear above these status lines."}
                  </p>
                </div>
              </div>
              <div className="rpc-panel">
                <div className="rpc-panel-heading">
                  <h2>Start with a style</h2>
                  <span>MAKE IT YOURS</span>
                </div>
                <div className="rpc-presets">
                  {STYLE_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.name}
                      onClick={() => patch(preset.patch)}
                      aria-label={`Use ${preset.name} style`}
                    >
                      <Artwork source={preset.patch.largeImage} />
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rpc-panel">
                <div className="rpc-panel-heading">
                  <h2>What you’re doing</h2>
                </div>
                <div className="rpc-form-body">
                  <div className="rpc-mode" role="group" aria-label="Activity mode">
                    {(["auto", "custom"] as const).map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        aria-pressed={draft.mode === mode}
                        onClick={() => patch({ mode })}
                      >
                        {mode === "auto" ? "Follow my activity" : "Custom status"}
                      </button>
                    ))}
                  </div>
                  <p className="rpc-caption">
                    {draft.mode === "auto"
                      ? "Follows the selected thread: working, connecting, waiting for approval or input, and completed. Hidden running agents stay visible."
                      : "Keep a personal message while you work."}
                  </p>
                  {draft.mode === "custom"
                    ? textField("customActivity", "My activity", {
                        placeholder: "Building something great",
                      })
                    : null}
                  {textField("detailsTemplate", "First line", { placeholder: "{activity}" })}
                  {textField("stateTemplate", "Second line", { placeholder: "{project}" })}
                  <p className="rpc-caption rpc-tokens">
                    Available:{" "}
                    {TOKENS.map((token) => (
                      <code key={token}>{token}</code>
                    ))}
                  </p>
                  <div className="rpc-note">
                    Names follow the sharing controls below, including in custom text templates.
                  </div>
                </div>
              </div>
              <div className="rpc-panel">
                <div className="rpc-panel-heading">
                  <h2>Artwork & details</h2>
                </div>
                <div className="rpc-form-body">
                  <p className="rpc-caption">
                    Use a public HTTPS image link, or the key of an image uploaded to your Discord
                    application. Local files cannot be displayed by Discord.
                  </p>
                  {textField("largeImage", "Large image", {
                    maxLength: 512,
                    placeholder: "https://… or asset_key",
                  })}
                  {textField("largeText", "Large image hover text")}
                  {textField("smallImage", "Small badge image", {
                    maxLength: 512,
                    placeholder: "https://… or asset_key",
                  })}
                  {textField("smallText", "Small badge hover text")}
                  <div className="rpc-art-actions">
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          largeImage: DISCORD_ARTWORK.t3,
                          smallImage: DISCORD_ARTWORK.essentials,
                        })
                      }
                    >
                      Use T3 artwork
                    </button>
                    <button type="button" onClick={() => patch({ largeImage: "", smallImage: "" })}>
                      Remove images
                    </button>
                  </div>
                </div>
              </div>
              <div className="rpc-panel">
                <div className="rpc-panel-heading">
                  <h2>Sharing & timing</h2>
                </div>
                {toggle(
                  "showProject",
                  "Show project name",
                  "Use the selected project in {project}.",
                )}
                {toggle(
                  "showThread",
                  "Show thread title",
                  "Use the selected thread title in {thread}. Message contents are never shared.",
                )}
                {toggle(
                  "showElapsed",
                  "Show elapsed time",
                  "Display how long this T3 session has been open.",
                )}
                <div className="rpc-form-body">
                  <label className="rpc-field">
                    <span>Pause after</span>
                    <select
                      value={draft.idleMinutes}
                      onChange={(event) => patch({ idleMinutes: Number(event.target.value) })}
                    >
                      {[...new Set([...IDLE_MINUTE_OPTIONS, draft.idleMinutes])]
                        .toSorted((a, b) => a - b)
                        .map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} minutes without input
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="rpc-caption">
                    A running agent takes priority over idle and background status.
                  </p>
                </div>
              </div>
              <details className="rpc-panel rpc-links">
                <summary>
                  Profile buttons<span>OPTIONAL</span>
                </summary>
                <div className="rpc-form-body">
                  {textField("buttonLabel", "Button 1 label", { maxLength: 32 })}
                  {textField("buttonUrl", "Button 1 link", {
                    maxLength: 512,
                    placeholder: "https://…",
                  })}
                  {textField("secondButtonLabel", "Button 2 label", { maxLength: 32 })}
                  {textField("secondButtonUrl", "Button 2 link", {
                    maxLength: 512,
                    placeholder: "https://…",
                  })}
                  <p className="rpc-caption">Add up to two links below your activity.</p>
                </div>
              </details>
              <footer className="rpc-save-bar">
                <span role="status">
                  {saving
                    ? "Saving…"
                    : saved
                      ? "Saved · updating Discord"
                      : dirty
                        ? "You have unsaved changes"
                        : "Saved on this device"}
                </span>
                <div>
                  <button
                    type="button"
                    className="rpc-reset"
                    onClick={() => {
                      if (!resetArmed) {
                        setResetArmed(true);
                        return;
                      }
                      patch({ ...DISCORD_PRESENCE_DEFAULTS, clientId: draft.clientId });
                      setResetArmed(false);
                    }}
                  >
                    {resetArmed ? "Confirm reset" : "Reset"}
                  </button>
                  <button
                    type="button"
                    className="rpc-save"
                    disabled={!dirty || saving}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save presence"}
                  </button>
                </div>
              </footer>
            </div>
            <aside className="rpc-preview-column" aria-label="Discord presence preview">
              <div className="rpc-preview-sticky">
                <div className="rpc-preview-label">
                  <span>PROFILE PREVIEW</span>
                  <span>{dirty ? "UNSAVED DRAFT" : "LIVE CONFIG"}</span>
                </div>
                <div className="rpc-discord-card" data-disabled={!draft.enabled}>
                  <div className="rpc-card-top">
                    <span>PLAYING A GAME</span>
                    <span className="rpc-card-dot" />
                  </div>
                  <div className="rpc-card-body">
                    <div className="rpc-artwork-stack">
                      <Artwork source={activity.assets?.large_image} />
                      {activity.assets?.small_image ? (
                        <Artwork source={activity.assets.small_image} small />
                      ) : null}
                    </div>
                    <div className="rpc-card-copy">
                      <strong>
                        {isDefaultApplication ? "Essentials" : "Your Discord application"}
                      </strong>
                      <Tooltip>
                        <TooltipTrigger render={<span />}>{activity.details}</TooltipTrigger>
                        <TooltipPopup>{activity.details}</TooltipPopup>
                      </Tooltip>
                      {activity.state ? (
                        <Tooltip>
                          <TooltipTrigger render={<span />}>{activity.state}</TooltipTrigger>
                          <TooltipPopup>{activity.state}</TooltipPopup>
                        </Tooltip>
                      ) : null}
                      {draft.showElapsed ? (
                        <small>{formatElapsed(nowSeconds - startedAt)} elapsed</small>
                      ) : null}
                    </div>
                  </div>
                  {activity.buttons?.map((button) => (
                    <div className="rpc-preview-button" key={button.label + button.url}>
                      {button.label}
                    </div>
                  ))}
                  {!draft.enabled ? (
                    <div className="rpc-disabled-note">Presence is disabled</div>
                  ) : null}
                </div>
                <div className="rpc-scenarios" role="group" aria-label="Preview scenario">
                  {(
                    [
                      ["live", "Live"],
                      ["working", "Working"],
                      ["idle", "On a break"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={scenario === key}
                      onClick={() => setScenario(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="rpc-caption">
                  Draft preview. Saved changes reach Discord within 15 seconds. Asset keys and final
                  image rendering are resolved by Discord.
                </p>
                <div className="rpc-live-summary">
                  <span>WORKSPACE SIGNAL</span>
                  <strong>{live?.activity.details ?? "Waiting for activity"}</strong>
                  <small>{live?.context.threads ?? 0} active threads · text and images only</small>
                </div>
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
