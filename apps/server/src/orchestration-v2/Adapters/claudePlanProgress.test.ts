import { describe, expect, it } from "vite-plus/test";

import { claudePlanProgressSteps, isClaudePlanProgressTool } from "./claudePlanProgress.ts";

const created = claudePlanProgressSteps(
  {
    id: "bar",
    stages: [
      { name: "A", steps: [{ title: "Read" }, { title: "Write" }] },
      { name: "B", steps: [{ title: "Test" }] },
    ],
  },
  undefined,
);

const view = (steps: ReturnType<typeof claudePlanProgressSteps>) =>
  steps?.map((step) => `${step.text}:${step.status}`);

describe("claudePlanProgressSteps", () => {
  it("flattens stages and starts the first open step", () => {
    expect(view(created)).toEqual(["Read:running", "Write:pending", "Test:pending"]);
    expect(created?.map((step) => step.id)).toEqual(["bar:0", "bar:1", "bar:2"]);
  });

  it("applies next, done, active and failed to the bar's own steps", () => {
    const next = claudePlanProgressSteps({ id: "bar", next: true }, created);
    expect(view(next)).toEqual(["Read:completed", "Write:running", "Test:pending"]);
    const moved = claudePlanProgressSteps({ id: "bar", done: ["Write"], active: "Test" }, next);
    expect(view(moved)).toEqual(["Read:completed", "Write:completed", "Test:running"]);
    const failed = claudePlanProgressSteps({ id: "bar", failed: "Test" }, moved);
    expect(view(failed)).toEqual(["Read:completed", "Write:completed", "Test:pending"]);
    expect(view(claudePlanProgressSteps({ id: "bar", state: "done" }, failed))).toEqual([
      "Read:completed",
      "Write:completed",
      "Test:completed",
    ]);
  });

  it("keeps finished steps when the stages are resent and honors explicit statuses", () => {
    const next = claudePlanProgressSteps({ id: "bar", next: true }, created);
    const resent = claudePlanProgressSteps(
      {
        id: "bar",
        stages: [
          {
            name: "A",
            steps: [{ title: "Read" }, { title: "Write" }, { title: "Ship", status: "done" }],
          },
        ],
      },
      next,
    );
    expect(view(resent)).toEqual(["Read:completed", "Write:running", "Ship:completed"]);
  });

  it("moves on after the finished step, and leaves the list alone for an unknown active title", () => {
    const afterFailure = claudePlanProgressSteps({ id: "bar", failed: "Read" }, created);
    const second = claudePlanProgressSteps({ id: "bar", active: "Write" }, afterFailure);
    expect(view(claudePlanProgressSteps({ id: "bar", next: true }, second))).toEqual([
      "Read:pending",
      "Write:completed",
      "Test:running",
    ]);
    expect(view(claudePlanProgressSteps({ id: "bar", active: "Writ" }, second))).toEqual(
      view(second),
    );
    const odd = claudePlanProgressSteps(
      { id: "bar", stages: [{ name: "A", steps: [{ title: "x", status: "constructor" }] }] },
      undefined,
    );
    expect(view(odd)).toEqual(["x:running"]);
  });

  it("keeps one running step and does not restart a failed one", () => {
    const stages = (status?: string) => [
      { name: "A", steps: [{ title: "Read" }, { title: "Write", status }] },
    ];
    expect(view(claudePlanProgressSteps({ id: "bar", stages: stages("active") }, created))).toEqual(
      ["Read:pending", "Write:running"],
    );
    expect(
      view(claudePlanProgressSteps({ id: "bar", stages: stages(), failed: "Read" }, created)),
    ).toEqual(["Read:pending", "Write:running"]);
    expect(
      view(
        claudePlanProgressSteps(
          { id: "bar", stages: [{ name: "A", steps: [{ title: "Only", status: "error" }] }] },
          undefined,
        ),
      ),
    ).toEqual(["Only:pending"]);
  });

  it("does not treat a bar whose id extends another id as the same bar", () => {
    const nested = claudePlanProgressSteps(
      { id: "bar:x", stages: [{ name: "A", steps: [{ title: "x" }] }] },
      undefined,
    );
    expect(claudePlanProgressSteps({ id: "bar", next: true }, nested)).toBeNull();
  });

  it("ignores another list and unknown bars, and unwraps recorded input", () => {
    expect(claudePlanProgressSteps({ id: "other", next: true }, created)).toBeNull();
    expect(claudePlanProgressSteps({ id: "bar", next: true }, undefined)).toBeNull();
    expect(claudePlanProgressSteps({ next: true }, created)).toBeNull();
    expect(
      view(
        claudePlanProgressSteps(
          {
            type: "record",
            value: { id: "bar", stages: [{ name: "A", steps: [{ title: "x" }] }] },
          },
          undefined,
        ),
      ),
    ).toEqual(["x:running"]);
  });
});

describe("isClaudePlanProgressTool", () => {
  it("matches the plugin tool by name", () => {
    expect(isClaudePlanProgressTool("mcp__plan-progress__plan_progress")).toBe(true);
    expect(isClaudePlanProgressTool("mcp__plugin_x_plan-progress__plan_progress")).toBe(true);
    expect(isClaudePlanProgressTool("TodoWrite")).toBe(false);
  });
});
