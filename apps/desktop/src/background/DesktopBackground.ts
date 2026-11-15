// @effect-diagnostics nodeBuiltinImport:off -- Preferences are tiny and read once before the tray exists; the controller API is synchronous so it stays unit-testable.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../app/DesktopLifecycle.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronPowerMonitor from "../electron/ElectronPowerMonitor.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  DISCORD_PRESENCE_CONTEXT_CHANNEL,
  DISCORD_PRESENCE_GET_CHANNEL,
  DISCORD_PRESENCE_SAVE_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import {
  DesktopBackgroundController,
  isMissingFile,
  type BackgroundWindow,
} from "./DesktopBackgroundController.ts";
import { DiscordRpcClient } from "./DiscordRpcClient.ts";

export class DesktopBackground extends Context.Service<
  DesktopBackground,
  {
    readonly install: Effect.Effect<void, DesktopIpc.DesktopIpcRegistrationError, Scope.Scope>;
  }
>()("@t3tools/desktop/background/DesktopBackground") {}

const { logWarning: logBackgroundWarning } = makeComponentLogger("desktop-background");

export class DesktopBackgroundIpcError extends Schema.TaggedError<DesktopBackgroundIpcError>()(
  "DesktopBackgroundIpcError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : "Discord presence request failed.";
  }
}

function toBackgroundWindow(window: Electron.BrowserWindow): BackgroundWindow {
  return {
    isDestroyed: () => window.isDestroyed(),
    isVisible: () => window.isVisible(),
    isMinimized: () => window.isMinimized(),
    restore: () => window.restore(),
    show: () => window.show(),
    focus: () => window.focus(),
    hide: () => window.hide(),
    navigate: (route) => {
      // Desktop routes through the hash; the route is a code constant.
      window.webContents
        .executeJavaScript(`window.location.hash=${JSON.stringify(route)}`)
        .catch((cause: unknown) => {
          Effect.runSync(logBackgroundWarning("failed to open settings route", { route, cause }));
        });
    },
  };
}

function writeFileAtomic(path: string, contents: string): void {
  const temporary = `${path}.tmp`;
  NodeFS.writeFileSync(temporary, contents, "utf8");
  NodeFS.renameSync(temporary, path);
}

function readFileIfPresent(path: string): string | undefined {
  try {
    return NodeFS.readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

/**
 * Close-to-tray and Discord Rich Presence. The window hides instead of closing
 * while `DesktopState.hideOnClose` is set; explicit quit and relaunch stay native.
 */
const install = Effect.fn("desktop.background.install")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const powerMonitor = yield* ElectronPowerMonitor.ElectronPowerMonitor;
  const assets = yield* DesktopAssets.DesktopAssets;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const context = yield* Effect.context<
    | DesktopLifecycle.DesktopLifecycleRuntimeServices
    | ElectronWindow.ElectronWindow
    | ElectronPowerMonitor.ElectronPowerMonitor
  >();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const iconPaths = yield* assets.iconPaths;
  const userDataPath = Electron.app.getPath("userData");

  const createTray = () => {
    if (environment.platform !== "win32" || Option.isNone(iconPaths.ico)) return null;
    const icon = Electron.nativeImage.createFromPath(iconPaths.ico.value);
    if (icon.isEmpty()) return null;
    const tray = new Electron.Tray(icon);
    tray.setToolTip(`${environment.displayName}: threads continue in the background`);
    return {
      setMenu: (template: ReadonlyArray<Electron.MenuItemConstructorOptions>) =>
        tray.setContextMenu(Electron.Menu.buildFromTemplate([...template])),
      onActivate: (listener: () => void) => {
        tray.on("click", listener);
        tray.on("double-click", listener);
      },
      destroy: () => tray.destroy(),
    };
  };

  const controller = new DesktopBackgroundController({
    readFile: readFileIfPresent,
    writeFileAtomic,
    joinPath: (name) => NodePath.join(userDataPath, name),
    createTray,
    createDiscord: (onStatus) => new DiscordRpcClient({ onStatus, platform: environment.platform }),
    mainWindow: () => {
      const window = runSync(electronWindow.main);
      return Option.isSome(window) ? toBackgroundWindow(window.value) : undefined;
    },
    idleSeconds: () => runSync(powerMonitor.getSystemIdleTime),
    relaunch: () => void runFork(lifecycle.relaunch("tray")),
    quit: () => void runFork(electronApp.quit),
    onHideOnCloseChange: (hideOnClose) => void runSync(Ref.set(state.hideOnClose, hideOnClose)),
    report: (message, cause) => {
      runSync(logBackgroundWarning(message, { cause }));
    },
  });

  yield* Effect.acquireRelease(
    Effect.sync(() => controller.start()),
    () => Effect.sync(() => controller.stop()),
  );
  yield* electronApp.on("before-quit", () => controller.stop());
  yield* electronApp.on("second-instance", (_event: unknown, argv: readonly string[]) => {
    controller.handleSecondInstance(argv);
  });

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DISCORD_PRESENCE_GET_CHANNEL,
      payload: Schema.Undefined,
      result: Schema.Unknown,
      handler: () => Effect.sync(() => controller.getDiscordSnapshot()),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DISCORD_PRESENCE_SAVE_CHANNEL,
      payload: Schema.Unknown,
      result: Schema.Unknown,
      handler: (config) =>
        Effect.try({
          try: () => controller.saveDiscordConfig(config),
          catch: (cause) => new DesktopBackgroundIpcError({ cause }),
        }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DISCORD_PRESENCE_CONTEXT_CHANNEL,
      payload: Schema.Unknown,
      result: Schema.Void,
      handler: (value) => Effect.sync(() => controller.reportActivityContext(value)),
    }),
  );
});

export const layer = Layer.effect(
  DesktopBackground,
  Effect.gen(function* () {
    const context = yield* Effect.context<Effect.Services<ReturnType<typeof install>>>();
    return DesktopBackground.of({ install: install().pipe(Effect.provideContext(context)) });
  }),
);
