import type { OrchestrationV2PlanStep } from "@t3tools/contracts";

type StepStatus = OrchestrationV2PlanStep["status"];

const PLAN_PROGRESS_TOOL = /^mcp__.*plan-progress__plan_progress$/u;

const STAGE_STEP_STATUS: ReadonlyMap<string, StepStatus> = new Map([
  ["pending", "pending"],
  ["active", "running"],
  ["done", "completed"],
  ["skipped", "completed"],
  ["error", "pending"],
]);

export const isClaudePlanProgressTool = (toolName: string): boolean =>
  PLAN_PROGRESS_TOOL.test(toolName);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const callArguments = (input: unknown): unknown =>
  field(input, "type") === "record" && field(input, "value") !== undefined
    ? field(input, "value")
    : input;

/** The bar a `plan_progress` call belongs to, or null for a call without one. */
export const claudePlanProgressBarId = (input: unknown): string | null =>
  trimmed(field(callArguments(input), "id")) || null;

/** Starts the first open step after `afterIndex`, else the first open step of the list. */
const startNextStep = (
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  afterIndex: number,
  blocked: ReadonlySet<string>,
): ReadonlyArray<OrchestrationV2PlanStep> => {
  const open = (step: OrchestrationV2PlanStep) =>
    step.status === "pending" && !blocked.has(step.text);
  const target = steps.findIndex((step, index) => index > afterIndex && open(step));
  const index = target >= 0 ? target : steps.findIndex(open);
  return index < 0
    ? steps
    : steps.map((step, at) => (at === index ? { ...step, status: "running" } : step));
};

/**
 * Folds one `plan_progress` call into the checklist of its bar, so the thread details card shows
 * that tool's steps like a TodoWrite list. `previous` holds the bar's earlier steps; their ids
 * carry the bar id, so a list of another bar is never mistaken for it. Null: nothing to show.
 */
export function claudePlanProgressSteps(
  input: unknown,
  previous: ReadonlyArray<OrchestrationV2PlanStep> | null | undefined,
): ReadonlyArray<OrchestrationV2PlanStep> | null {
  const args = callArguments(input);
  const barId = claudePlanProgressBarId(input);
  if (barId === null) return null;
  const prefix = `${barId}:`;
  const own = (previous ?? []).filter(
    (step) => step.id.startsWith(prefix) && /^\d+$/u.test(step.id.slice(prefix.length)),
  );
  // A step the agent just reported as failed or errored waits for the agent to pick it up again.
  const blocked = new Set<string>();

  const stages = list(field(args, "stages"));
  const created = stages.length > 0;
  let steps: ReadonlyArray<OrchestrationV2PlanStep>;
  if (created) {
    const known = new Map(own.map((step) => [step.text, step.status]));
    steps = stages
      .flatMap((stage) => list(field(stage, "steps")))
      .flatMap((step) => {
        const text = trimmed(field(step, "title"));
        const rawStatus = trimmed(field(step, "status"));
        if (text === "") return [];
        if (rawStatus === "error") blocked.add(text);
        return [{ text, explicit: STAGE_STEP_STATUS.get(rawStatus) }];
      })
      .map(({ text, explicit }, index) => ({
        id: `${prefix}${index}`,
        text,
        status: explicit ?? known.get(text) ?? "pending",
      }));
    const explicitActive = stages
      .flatMap((stage) => list(field(stage, "steps")))
      .findLast((step) => trimmed(field(step, "status")) === "active");
    if (explicitActive !== undefined) {
      const activeText = trimmed(field(explicitActive, "title"));
      steps = steps.map((step) =>
        step.status === "running" && step.text !== activeText
          ? { ...step, status: "pending" }
          : step,
      );
    }
  } else {
    steps = own;
  }
  if (steps.length === 0) return null;

  const withStatus = (title: string, status: StepStatus) => {
    steps = steps.map((step) => (step.text === title ? { ...step, status } : step));
  };

  for (const title of list(field(args, "done")).map(trimmed)) withStatus(title, "completed");
  const active = trimmed(field(args, "active"));
  if (active !== "" && steps.some((step) => step.text === active)) {
    steps = steps.map((step) =>
      step.text === active
        ? { ...step, status: "running" }
        : step.status === "running"
          ? { ...step, status: "pending" }
          : step,
    );
  }
  const failed = trimmed(field(args, "failed"));
  if (failed !== "") {
    withStatus(failed, "pending");
    blocked.add(failed);
  }
  if (field(args, "next") === true) {
    const finishedAt = steps.findLastIndex((step) => step.status === "running");
    steps = steps.map((step) =>
      step.status === "running" ? { ...step, status: "completed" } : step,
    );
    steps = startNextStep(steps, finishedAt, blocked);
  }
  if (field(args, "state") === "done") {
    steps = steps.map((step) => ({ ...step, status: "completed" }));
  }
  if (created && !steps.some((step) => step.status === "running")) {
    steps = startNextStep(steps, -1, blocked);
  }
  return steps;
}
