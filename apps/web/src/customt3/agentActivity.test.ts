import { describe, expect, it } from "vite-plus/test";

import {
  agentKind,
  currentAction,
  type ActivityItem,
  type ActivityProjection,
  type ActivityThread,
} from "./agentActivity";

const thread: ActivityThread = {
  runtime: { status: "running", activeRunId: "current" },
  latestRun: { runId: "current", status: "running" },
};
const projection = (...items: ActivityItem[]): ActivityProjection => ({
  visibleTurnItems: items.map((item) => ({ item })),
});
const live = (type: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  type,
  runId: "current",
  status: "running",
  ...extra,
});

describe("agentKind", () => {
  it("follows the driver, with model and neutral fallbacks", () => {
    expect(agentKind({ modelSelection: { model: "gpt-6.1" } }, { driverKind: "claude" })).toBe(
      "claude",
    );
    for (const [model, kind] of [
      ["gpt-6.1-sol", "codex"],
      ["claude-opus", "claude"],
      ["gemini-3", "gemini"],
      ["custom", "unknown"],
    ] as const) {
      expect(agentKind({ modelSelection: { model } })).toBe(kind);
    }
  });
});

describe("currentAction", () => {
  it("distinguishes tools, writing and thinking from structured live items", () => {
    for (const [type, action] of [
      ["reasoning", "thinking"],
      ["assistant_message", "writing"],
      ["file_change", "editing"],
      ["file_search", "searching"],
      ["web_search", "searching"],
      ["command_execution", "command"],
      ["dynamic_tool", "tool"],
      ["subagent", "delegating"],
      ["compaction", "compacting"],
    ] as const) {
      expect(currentAction(thread, projection(live(type)))).toBe(action);
    }
    expect(currentAction(thread, projection(live("reasoning"), live("command_execution")))).toBe(
      "command",
    );
  });

  it("ignores completed tools and previous runs", () => {
    expect(currentAction(thread, projection(live("command_execution", { runId: "old" })))).toBe(
      "working",
    );
    expect(
      currentAction(thread, projection(live("command_execution", { status: "completed" }))),
    ).toBe("working");
    expect(
      currentAction(thread, projection(live("reasoning", { completedAt: "2026-11-13" }))),
    ).toBe("working");
    expect(currentAction(thread, null)).toBe("working");
  });

  it("lets requests, blocked waits and terminal states override animation", () => {
    expect(currentAction({ ...thread, hasPendingApprovals: true }, null, "thinking")).toBe(
      "approval",
    );
    expect(currentAction({ ...thread, hasPendingUserInput: true })).toBe("input");
    expect(currentAction({ ...thread, blockedOnThreadWait: true })).toBe("waiting");
    expect(currentAction({ ...thread, runtime: { status: "starting" } })).toBe("connecting");
    expect(currentAction({ runtime: { status: "failed" } })).toBe("failed");
    expect(currentAction({ latestRun: { status: "completed" } })).toBe("done");
    expect(currentAction(null)).toBe("idle");
    expect(currentAction(thread, null, "compacting")).toBe("compacting");
  });
});
