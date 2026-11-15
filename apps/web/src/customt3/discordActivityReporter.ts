import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { DiscordActivityContext, DiscordActivityKind } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentProjects } from "../state/projects";
import { environmentThreadDetails, environmentThreadShells } from "../state/threads";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { AGENTS, agentKind, currentAction, type AgentAction } from "./agentActivity";

const REPORT_INTERVAL_MS = 3000;
const RESEND_AFTER_MS = 15_000;
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function discordActivity(action: AgentAction): DiscordActivityKind {
  return action === "idle" ? "ready" : action;
}

function readContext(router: AnyRouter): DiscordActivityContext {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const ref = target?.kind === "server" ? target.threadRef : null;
  const thread = ref
    ? appAtomRegistry.get(environmentThreadShells.quietThreadShellAtom(ref))
    : null;
  const project = thread
    ? appAtomRegistry.get(
        environmentProjects.projectAtom(scopeProjectRef(thread.environmentId, thread.projectId)),
      )
    : null;
  const threads = appAtomRegistry
    .get(environmentThreadShells.quietThreadShellsAtom)
    .filter((entry) => RUNNING_STATUSES.has(entry.runtime?.status ?? "")).length;
  let activity: DiscordActivityKind = router.state.location.pathname.startsWith("/settings")
    ? "settings"
    : "browsing";
  if (thread && ref) {
    const visibleTurnItems = appAtomRegistry.get(
      environmentThreadDetails.quietVisibleTurnItemsAtom(ref),
    );
    activity = discordActivity(currentAction(thread, { visibleTurnItems }));
  }
  return {
    activity,
    project: project?.title ?? "",
    thread: thread?.title ?? "",
    threads,
    agent: AGENTS[agentKind(thread)].label as DiscordActivityContext["agent"],
  };
}

/** Reports the open thread's activity to the desktop host; never reads message text. */
export function startDiscordActivityReporter(router: AnyRouter): void {
  const bridge = window.desktopBridge?.discordPresence;
  if (!bridge) return;
  let lastContext = "";
  let lastSent = 0;
  const report = () => {
    try {
      const context = readContext(router);
      const serialized = JSON.stringify(context);
      if (serialized === lastContext && Date.now() - lastSent < RESEND_AFTER_MS) return;
      lastContext = serialized;
      lastSent = Date.now();
      void bridge.reportContext(context).catch(() => undefined);
    } catch {
      // A transient atom or route state must not break the app.
    }
  };
  router.subscribe("onResolved", report);
  window.setInterval(report, REPORT_INTERVAL_MS);
  report();
}
