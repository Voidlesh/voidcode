import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopBackgroundController,
  type BackgroundDiscord,
  type BackgroundTray,
  type BackgroundWindow,
} from "./DesktopBackgroundController.ts";

class FakeWindow implements BackgroundWindow {
  hidden = false;
  focused = false;
  routes: string[] = [];
  isDestroyed = () => false;
  isVisible = () => true;
  isMinimized = () => false;
  restore() {}
  show() {
    this.hidden = false;
  }
  focus() {
    this.focused = true;
  }
  hide() {
    this.hidden = true;
  }
  navigate(route: string) {
    this.routes.push(route);
  }
}

type Call = readonly [kind: string, ...rest: ReadonlyArray<unknown>];

function fixture({ trayAvailable = true, files = {} as Record<string, string> } = {}) {
  const discordCalls: Call[] = [];
  const written = new Map<string, string>();
  const hideChanges: boolean[] = [];
  const quitCalls: string[] = [];
  let menu: ReadonlyArray<MenuItemConstructorOptions> = [];
  let activate: () => void = () => {};
  let statusListener: (status: string) => void = () => {};

  const discord: BackgroundDiscord = {
    startedAt: 100,
    presence: {},
    config: undefined as never,
    start(config) {
      this.config = config;
      discordCalls.push(["start", config]);
    },
    update(presence, context) {
      this.presence = presence;
      discordCalls.push(["update", presence, context]);
    },
    stop() {
      discordCalls.push(["stop"]);
    },
  };
  const tray: BackgroundTray = {
    setMenu: (template) => {
      menu = template;
    },
    onActivate: (listener) => {
      activate = listener;
    },
    destroy: () => {},
  };
  const window = new FakeWindow();

  const controller = new DesktopBackgroundController({
    readFile: (path) => written.get(path) ?? files[path.replace(/^\/user\//, "")],
    writeFileAtomic: (path, contents) => void written.set(path, contents),
    joinPath: (name) => `/user/${name}`,
    createTray: () => (trayAvailable ? tray : null),
    createDiscord: (onStatus) => {
      statusListener = onStatus;
      return discord;
    },
    mainWindow: () => window,
    idleSeconds: () => 0,
    relaunch: () => void quitCalls.push("relaunch"),
    quit: () => void quitCalls.push("quit"),
    onHideOnCloseChange: (hide) => void hideChanges.push(hide),
    report: () => {},
  });
  controller.start();

  const item = (label: string) => {
    const found = menu.find((entry) => entry.label === label);
    if (!found) throw new Error(`missing menu item ${label}`);
    return found;
  };
  const click = (entry: MenuItemConstructorOptions, checked = false) =>
    (entry.click as unknown as (item: { checked: boolean }) => void)({ checked });
  return {
    controller,
    window,
    discordCalls,
    written,
    hideChanges,
    quitCalls,
    item,
    click,
    activate: () => activate(),
    emitStatus: (status: string) => statusListener(status),
    discordSubmenu: () =>
      item("Discord Rich Presence").submenu as ReadonlyArray<MenuItemConstructorOptions>,
  };
}

describe("DesktopBackgroundController", () => {
  it("hides on close while the tray exists and reopens from the tray", () => {
    const { controller, window, activate, hideChanges } = fixture();
    expect(controller.shouldHideOnClose()).toBe(true);
    expect(hideChanges.at(-1)).toBe(true);
    window.hide();
    activate();
    expect(window.hidden).toBe(false);
    expect(window.focused).toBe(true);
  });

  it("keeps the normal close behavior when the tray is unavailable", () => {
    const { controller } = fixture({ trayAvailable: false });
    expect(controller.shouldHideOnClose()).toBe(false);
  });

  it("can disable background running from the tray and persists the choice", () => {
    const { controller, item, click, written, hideChanges } = fixture();
    click(item("Keep running when window closes"), false);
    expect(controller.shouldHideOnClose()).toBe(false);
    expect(hideChanges.at(-1)).toBe(false);
    expect(written.get("/user/customt3-background.json")).toBe('{"keepRunning":false}');
  });

  it("honors a stored keepRunning preference", () => {
    const { controller } = fixture({
      files: { "customt3-background.json": '{"keepRunning":false}' },
    });
    expect(controller.shouldHideOnClose()).toBe(false);
  });

  it("routes explicit restart and quit through the app lifecycle", () => {
    const { item, click, quitCalls, controller } = fixture();
    click(item("Restart T3 Code"));
    click(item("Quit T3 Code"));
    controller.handleSecondInstance(["app.exe", "--customt3-quit"]);
    controller.handleSecondInstance(["app.exe"]);
    expect(quitCalls).toEqual(["relaunch", "quit", "quit"]);
  });

  it("opens the Discord settings route from the tray", () => {
    const { discordSubmenu, click, window } = fixture();
    const customize = discordSubmenu().find((entry) => entry.label?.startsWith("Customize"));
    click(customize!);
    expect(window.routes).toEqual(["/settings/discord"]);
  });

  it("starts Discord with the default ID, reports status in the menu and stops on shutdown", () => {
    const { discordCalls, controller, discordSubmenu, emitStatus } = fixture();
    expect(discordCalls[0]).toMatchObject(["start", { clientId: "878349344737222696" }]);
    expect(discordCalls[1]![0]).toBe("update");
    emitStatus("Connected");
    expect(discordSubmenu()[0]!.label).toBe("Connected");
    controller.stop();
    expect(discordCalls.at(-1)).toEqual(["stop"]);
  });

  it("persists bounded settings, reconnects only when needed and rejects invalid IDs", () => {
    const { controller, discordCalls, written } = fixture();
    const base = controller.getDiscordSnapshot().config;
    expect(() => controller.saveDiscordConfig({ clientId: "token" })).toThrow(/Application ID/);
    expect(() => controller.saveDiscordConfig([])).toThrow(/Invalid/);
    const starts = () => discordCalls.filter(([kind]) => kind === "start").length;
    const before = starts();
    controller.saveDiscordConfig({ ...base, detailsTemplate: "My workspace" });
    expect(starts()).toBe(before);
    const result = controller.saveDiscordConfig({ ...base, enabled: false });
    expect(starts()).toBe(before + 1);
    expect(result.config.enabled).toBe(false);
    expect(JSON.parse(written.get("/user/customt3-discord.json")!).enabled).toBe(false);
  });

  it("reflects reported activity context in the snapshot", () => {
    const { controller } = fixture();
    controller.reportActivityContext({
      activity: "working",
      project: "customt3",
      thread: "Feature",
      threads: 2,
    });
    const snapshot = controller.getDiscordSnapshot();
    expect(snapshot.context.project).toBe("customt3");
    expect(snapshot.activity.details).toBe("Agent is working");
  });
});
