import type { OrchestrationV2PlanArtifact, OrchestrationV2PlanStep } from "@t3tools/contracts";

export interface ThreadProgress {
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly done: number;
  readonly total: number;
  /** The step the agent is on now: the running one, else the first still pending. */
  readonly current: OrchestrationV2PlanStep | null;
}

/**
 * The checklist of the thread's latest run. Lists are never closed when a run ends, so one from an
 * earlier run would show a step as running that nobody is working on.
 */
export function deriveThreadProgress(
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
  latestRunId: OrchestrationV2PlanArtifact["runId"],
): ThreadProgress | null {
  if (latestRunId === null) return null;
  for (let index = plans.length - 1; index >= 0; index -= 1) {
    const plan = plans[index];
    if (
      plan?.kind !== "todo_list" ||
      plan.runId !== latestRunId ||
      plan.status === "superseded" ||
      plan.steps.length === 0
    ) {
      continue;
    }
    return {
      steps: plan.steps,
      done: plan.steps.filter((step) => step.status === "completed").length,
      total: plan.steps.length,
      current:
        plan.steps.find((step) => step.status === "running") ??
        plan.steps.find((step) => step.status === "pending") ??
        null,
    };
  }
  return null;
}
