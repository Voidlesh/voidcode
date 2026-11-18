/* oxlint-disable t3code/no-untranslated-copy -- fork-only copy, English only */
// Uses structured run metadata only, never guesses actions from message text.
export type AgentKind = "claude" | "codex" | "gemini" | "cursor" | "unknown";

export type AgentAction =
  | "working"
  | "thinking"
  | "writing"
  | "editing"
  | "searching"
  | "command"
  | "tool"
  | "delegating"
  | "connecting"
  | "compacting"
  | "approval"
  | "input"
  | "waiting"
  | "failed"
  | "done"
  | "idle";

export const AGENTS: Readonly<Record<AgentKind, { label: string; color: string }>> = {
  claude: { label: "Claude", color: "#d97757" },
  codex: { label: "Codex", color: "#10a37f" },
  gemini: { label: "Gemini", color: "#4285f4" },
  cursor: { label: "Cursor", color: "#a78bfa" },
  unknown: { label: "Agent", color: "#8495ad" },
};

export const ACTIONS: Readonly<Record<AgentAction, readonly [label: string, color: string]>> = {
  working: ["Arbeitet", "#8899b5"],
  thinking: ["Denkt nach", "#a78bfa"],
  writing: ["Schreibt", "#34b5a5"],
  editing: ["Bearbeitet Dateien", "#4d9de0"],
  searching: ["Sucht", "#22b8cf"],
  command: ["Führt einen Befehl aus", "#e6a23c"],
  tool: ["Verwendet ein Werkzeug", "#e6a23c"],
  delegating: ["Arbeitet mit Subagenten", "#d879b5"],
  connecting: ["Verbindet", "#8899b5"],
  compacting: ["Komprimiert den Kontext", "#a78bfa"],
  approval: ["Wartet auf Freigabe", "#e6a23c"],
  input: ["Wartet auf Eingabe", "#e6a23c"],
  waiting: ["Wartet", "#8899b5"],
  failed: ["Fehlgeschlagen", "#ef6464"],
  done: ["Fertig", "#10a37f"],
  idle: ["Bereit", "#8899b5"],
};

export interface ActivityThread {
  readonly modelSelection?: { readonly model?: string | null } | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly pendingSubagentRequest?: string | null;
  readonly blockedOnThreadWait?: boolean;
  readonly runtime?: {
    readonly status?: string | null;
    readonly activeRunId?: string | null;
    readonly providerName?: string | null;
  } | null;
  readonly latestRun?: { readonly runId?: string | null; readonly status?: string | null } | null;
}

export interface ActivityItem {
  readonly type: string;
  readonly runId?: string | null;
  readonly status?: string | null;
  readonly completedAt?: unknown;
  readonly streaming?: unknown;
}

export interface ActivityProjection {
  readonly visibleTurnItems?: ReadonlyArray<{ readonly item?: ActivityItem | null }>;
}

const ACTIVE_ITEM_STATUSES: ReadonlySet<string> = new Set(["running", "inProgress", "pending"]);
const ITEM_ACTIONS: Readonly<Record<string, AgentAction>> = {
  reasoning: "thinking",
  assistant_message: "writing",
  proposed_plan: "writing",
  file_change: "editing",
  file_search: "searching",
  web_search: "searching",
  command_execution: "command",
  subagent: "delegating",
  dynamic_tool: "tool",
  compaction: "compacting",
};

export function agentKind(
  thread: ActivityThread | null | undefined,
  provider?: { readonly driverKind?: string | null } | null,
): AgentKind {
  const driver = provider?.driverKind;
  if (driver && Object.hasOwn(AGENTS, driver)) return driver as AgentKind;
  const model =
    `${thread?.modelSelection?.model ?? ""} ${thread?.runtime?.providerName ?? ""}`.toLowerCase();
  if (/claude|anthropic/.test(model)) return "claude";
  if (/codex|gpt-|^o[134](?:\s|-|$)|openai/.test(model)) return "codex";
  if (/gemini/.test(model)) return "gemini";
  if (/cursor/.test(model)) return "cursor";
  return "unknown";
}

export function currentAction(
  thread: ActivityThread | null | undefined,
  projection?: ActivityProjection | null,
  override?: AgentAction | null,
): AgentAction {
  if (!thread) return "idle";
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") return "approval";
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") return "input";
  const status = thread.runtime?.status;
  if (status === "queued" || status === "preparing" || status === "starting") return "connecting";
  if (status === "failed" || thread.latestRun?.status === "failed") return "failed";
  if (status !== "running" && status !== "waiting") {
    return thread.latestRun?.status === "completed" ? "done" : "idle";
  }
  if (thread.blockedOnThreadWait) return "waiting";
  if (override && Object.hasOwn(ACTIONS, override)) return override;
  const runId = thread.runtime?.activeRunId ?? thread.latestRun?.runId;
  const items = projection?.visibleTurnItems ?? [];
  for (let i = items.length - 1; i >= 0; --i) {
    const item = items[i]?.item;
    if (!item || !runId || item.runId !== runId) continue;
    if (item.completedAt != null) continue;
    if (!ACTIVE_ITEM_STATUSES.has(item.status ?? "") && !item.streaming) continue;
    const action = ITEM_ACTIONS[item.type];
    if (action) return action;
  }
  return "working";
}
