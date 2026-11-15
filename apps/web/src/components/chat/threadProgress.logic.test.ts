import type { OrchestrationV2PlanArtifact } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadProgress } from "./threadProgress.logic";

const RUN = "run-1" as OrchestrationV2PlanArtifact["runId"];
const OLD_RUN = "run-0" as OrchestrationV2PlanArtifact["runId"];

const todoList = (
  id: string,
  status: "active" | "completed" | "superseded",
  steps: ReadonlyArray<readonly [string, "pending" | "running" | "completed"]>,
  runId: OrchestrationV2PlanArtifact["runId"] = RUN,
) =>
  ({
    id,
    threadId: "thread-1",
    runId,
    nodeId: `node-${id}`,
    kind: "todo_list",
    status,
    steps: steps.map(([text, stepStatus], index) => ({
      id: `${id}-${index}`,
      text,
      status: stepStatus,
    })),
  }) as unknown as OrchestrationV2PlanArtifact;

const proposedPlan = (id: string) =>
  ({
    id,
    threadId: "thread-1",
    runId: RUN,
    nodeId: `node-${id}`,
    kind: "proposed_plan",
    status: "active",
    markdown: "# Plan",
  }) as unknown as OrchestrationV2PlanArtifact;

describe("deriveThreadProgress", () => {
  it("counts finished steps and points at the running one", () => {
    const progress = deriveThreadProgress(
      [
        todoList("a", "active", [
          ["Read the code", "completed"],
          ["Write the fix", "running"],
          ["Run the tests", "pending"],
        ]),
      ],
      RUN,
    );
    expect(progress).toMatchObject({ done: 1, total: 3, current: { text: "Write the fix" } });
  });

  it("falls back to the first pending step when none is running", () => {
    const progress = deriveThreadProgress(
      [
        todoList("a", "active", [
          ["Read the code", "completed"],
          ["Write the fix", "pending"],
        ]),
      ],
      RUN,
    );
    expect(progress?.current?.text).toBe("Write the fix");
  });

  it("uses the newest list and skips superseded lists, proposed plans, and empty lists", () => {
    const progress = deriveThreadProgress(
      [
        todoList("old", "superseded", [["Old step", "pending"]]),
        todoList("new", "active", [["New step", "running"]]),
        proposedPlan("p"),
        todoList("empty", "active", []),
      ],
      RUN,
    );
    expect(progress?.steps[0]?.text).toBe("New step");
  });

  it("ignores a list from an earlier run, finished or not", () => {
    const plans = [
      todoList("a", "active", [["Interrupted step", "running"]], OLD_RUN),
      todoList("b", "completed", [["Finished step", "completed"]], OLD_RUN),
    ];
    expect(deriveThreadProgress(plans, RUN)).toBeNull();
  });

  it("keeps a finished list of the latest run with no current step", () => {
    const progress = deriveThreadProgress(
      [todoList("a", "completed", [["Only step", "completed"]])],
      RUN,
    );
    expect(progress).toMatchObject({ done: 1, total: 1, current: null });
  });

  it("returns null without a checklist or a run", () => {
    expect(deriveThreadProgress([proposedPlan("p")], RUN)).toBeNull();
    expect(deriveThreadProgress([], RUN)).toBeNull();
    expect(deriveThreadProgress([todoList("a", "active", [["Step", "pending"]])], null)).toBeNull();
  });
});
