// @effect-diagnostics globalTimers:off globalDate:off -- A synchronous periodic refresh of presence state, owned by this adapter and cleared in stop().
import {
  createDiscordActivity,
  normalizeDiscordActivityContext,
  normalizeDiscordPresenceConfig,
  type DiscordActivityContext,
  type DiscordPresenceConfig,
  type DiscordPresenceSnapshot,
  type DiscordPresenceState,
} from "@t3tools/shared/discordPresence";
import type { MenuItemConstructorOptions } from "electron";

const BACKGROUND_PREFERENCES_FILE = "customt3-background.json";
const DISCORD_CONFIG_FILE = "customt3-discord.json";
const QUIT_ARGUMENT = "--customt3-quit";
const DISCORD_SETTINGS_ROUTE = "/settings/discord";

const PRESENCE_REFRESH_MS = 15_000;
const CONTEXT_STALE_MS = 30_000;
const MAX_CONFIG_PAYLOAD_LENGTH = 10_000;

export interface BackgroundWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  hide(): void;
  navigate(route: string): void;
}

export interface BackgroundTray {
  setMenu(template: ReadonlyArray<MenuItemConstructorOptions>): void;
  onActivate(listener: () => void): void;
  destroy(): void;
}

export interface BackgroundDiscord {
  readonly startedAt: number;
  presence: DiscordPresenceState;
  config: DiscordPresenceConfig;
  start(config: DiscordPresenceConfig): void;
  update(presence: DiscordPresenceState, context: DiscordActivityContext): void;
  stop(): void;
}

export interface BackgroundDependencies {
  /** Returns undefined when the file does not exist; any other failure throws. */
  readonly readFile: (path: string) => string | undefined;
  readonly writeFileAtomic: (path: string, contents: string) => void;
  readonly joinPath: (name: string) => string;
  /** Null when the tray icon is unavailable; closing the window then keeps its normal behavior. */
  readonly createTray: () => BackgroundTray | null;
  readonly createDiscord: (onStatus: (status: string) => void) => BackgroundDiscord;
  readonly mainWindow: () => BackgroundWindow | undefined;
  readonly idleSeconds: () => number;
  readonly relaunch: () => void;
  readonly quit: () => void;
  readonly onHideOnCloseChange: (hideOnClose: boolean) => void;
  readonly report: (message: string, error: unknown) => void;
  readonly now?: () => number;
}

function isMissingFile(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

/**
 * Tray, close-to-background and Discord Rich Presence orchestration.
 * Electron specifics are injected so the behavior stays unit-testable.
 */
export class DesktopBackgroundController {
  private tray: BackgroundTray | null = null;
  private keepRunning = true;
  private discordConfig = normalizeDiscordPresenceConfig();
  private discordStatus = "Starting";
  private activityContext = normalizeDiscordActivityContext();
  private activityReceivedAt = 0;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private discord: BackgroundDiscord | undefined;

  private readonly deps: BackgroundDependencies;

  constructor(deps: BackgroundDependencies) {
    this.deps = deps;
  }

  start(): void {
    this.keepRunning = this.readKeepRunning();
    this.tray = this.deps.createTray();
    this.discord = this.deps.createDiscord((status) => this.setStatus(status));
    this.tray?.onActivate(() => this.showMainWindow());
    this.loadDiscord();
    this.refreshMenu();
    this.deps.onHideOnCloseChange(this.shouldHideOnClose());
    this.refreshTimer = setInterval(() => this.refreshPresence(), PRESENCE_REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  stop(): void {
    clearInterval(this.refreshTimer);
    this.discord?.stop();
    this.tray?.destroy();
    this.tray = null;
    this.deps.onHideOnCloseChange(false);
  }

  shouldHideOnClose(): boolean {
    return this.keepRunning && this.tray !== null;
  }

  handleSecondInstance(argv: ReadonlyArray<string>): void {
    if (argv.includes(QUIT_ARGUMENT)) this.deps.quit();
  }

  getDiscordSnapshot(): DiscordPresenceSnapshot {
    const startedAt = this.discord?.startedAt ?? 0;
    const presence = this.discord?.presence ?? {};
    return {
      config: this.discordConfig,
      status: this.discordStatus,
      context: this.activityContext,
      presence,
      activity: createDiscordActivity(
        this.discordConfig,
        this.activityContext,
        startedAt,
        presence,
      ),
      startedAt,
    };
  }

  saveDiscordConfig(value: unknown): DiscordPresenceSnapshot {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      JSON.stringify(value).length > MAX_CONFIG_PAYLOAD_LENGTH
    ) {
      throw new Error("Invalid Discord settings.");
    }
    const config = normalizeDiscordPresenceConfig(value);
    if (!config.clientId) throw new Error("Enter a valid Discord Application ID.");
    this.writeDiscordConfig(config);
    const reconnect =
      this.discordConfig.clientId !== config.clientId ||
      this.discordConfig.enabled !== config.enabled;
    this.discordConfig = config;
    if (reconnect) this.discord?.start(config);
    else if (this.discord) this.discord.config = config;
    this.refreshPresence();
    this.refreshMenu();
    return this.getDiscordSnapshot();
  }

  reportActivityContext(value: unknown): void {
    this.activityContext = normalizeDiscordActivityContext(value);
    this.activityReceivedAt = this.now();
    this.refreshPresence();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private readKeepRunning(): boolean {
    try {
      const text = this.deps.readFile(this.deps.joinPath(BACKGROUND_PREFERENCES_FILE));
      const parsed: unknown = text === undefined ? null : JSON.parse(text);
      const flag = (parsed as { keepRunning?: unknown } | null)?.keepRunning;
      return typeof flag === "boolean" ? flag : true;
    } catch (error) {
      this.deps.report("Could not read background preferences", error);
      return true;
    }
  }

  private setKeepRunning(keepRunning: boolean): void {
    try {
      this.deps.writeFileAtomic(
        this.deps.joinPath(BACKGROUND_PREFERENCES_FILE),
        JSON.stringify({ keepRunning }),
      );
      this.keepRunning = keepRunning;
    } catch (error) {
      this.deps.report("Could not save background preferences", error);
    }
    this.deps.onHideOnCloseChange(this.shouldHideOnClose());
    this.refreshMenu();
  }

  private writeDiscordConfig(config: DiscordPresenceConfig): void {
    this.deps.writeFileAtomic(
      this.deps.joinPath(DISCORD_CONFIG_FILE),
      JSON.stringify(config, null, 2),
    );
  }

  private loadDiscord(): void {
    try {
      const text = this.deps.readFile(this.deps.joinPath(DISCORD_CONFIG_FILE));
      if (text === undefined) {
        this.discordConfig = normalizeDiscordPresenceConfig();
        this.writeDiscordConfig(this.discordConfig);
      } else {
        this.discordConfig = normalizeDiscordPresenceConfig(JSON.parse(text));
      }
      this.discord?.start(this.discordConfig);
    } catch (error) {
      this.deps.report("Could not load Discord settings", error);
      this.setStatus("Could not read Discord settings");
    }
    this.refreshPresence();
  }

  private setStatus(status: string): void {
    if (this.discordStatus === status) return;
    this.discordStatus = status;
    this.refreshMenu();
  }

  private refreshPresence(): void {
    if (this.activityReceivedAt && this.now() - this.activityReceivedAt > CONTEXT_STALE_MS) {
      this.activityContext = normalizeDiscordActivityContext();
    }
    const window = this.deps.mainWindow();
    this.discord?.update(
      {
        idle: this.deps.idleSeconds() >= this.discordConfig.idleMinutes * 60,
        background: !window || window.isDestroyed() || !window.isVisible() || window.isMinimized(),
      },
      this.activityContext,
    );
  }

  private showMainWindow(): void {
    const window = this.deps.mainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private openDiscordSettings(): void {
    this.showMainWindow();
    const window = this.deps.mainWindow();
    if (window && !window.isDestroyed()) window.navigate(DISCORD_SETTINGS_ROUTE);
  }

  private setDiscordEnabled(enabled: boolean): void {
    try {
      this.writeDiscordConfig({ ...this.discordConfig, enabled });
    } catch (error) {
      this.deps.report("Could not save Discord settings", error);
      return;
    }
    this.loadDiscord();
    this.refreshMenu();
  }

  private buildMenu(): MenuItemConstructorOptions[] {
    return [
      { label: "Open T3 Code", click: () => this.showMainWindow() },
      { type: "separator" },
      {
        label: "Keep running when window closes",
        type: "checkbox",
        checked: this.keepRunning,
        click: (item) => this.setKeepRunning(item.checked),
      },
      { label: "Threads keep running while T3 Code is hidden", enabled: false },
      { type: "separator" },
      {
        label: "Discord Rich Presence",
        submenu: [
          { label: this.discordStatus, enabled: false },
          {
            label: "Enabled",
            type: "checkbox",
            checked: this.discordConfig.enabled,
            click: (item) => this.setDiscordEnabled(item.checked),
          },
          { label: "Customize Discord presence…", click: () => this.openDiscordSettings() },
        ],
      },
      { type: "separator" },
      { label: "Restart T3 Code", click: () => this.deps.relaunch() },
      { label: "Quit T3 Code", click: () => this.deps.quit() },
    ];
  }

  private refreshMenu(): void {
    this.tray?.setMenu(this.buildMenu());
  }
}

export { isMissingFile };
