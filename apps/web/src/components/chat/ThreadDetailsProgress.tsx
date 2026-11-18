/* oxlint-disable t3code/no-untranslated-copy -- fork-only copy, English only */
import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import type { ThreadProgress } from "./threadProgress.logic";

const STEP_STATUS_LABEL: Record<OrchestrationV2PlanStep["status"], string> = {
  pending: "To do",
  running: "In progress",
  completed: "Done",
};

/** The agent's own checklist: how far it is, then every step with its state. */
export function ThreadDetailsProgress({
  progress,
  isWorking,
}: {
  readonly progress: ThreadProgress;
  readonly isWorking: boolean;
}) {
  const percent = Math.round((progress.done / progress.total) * 100);
  return (
    <ThreadDetailsSection
      headingId="thread-details-progress-heading"
      title="Progress"
      showHeading={false}
    >
      <div className="flex flex-col gap-1.5 text-xs">
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} steps done`}
          className="flex flex-col gap-1.5 px-2.5 pt-1"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-foreground">Progress</span>
            <span className="tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          </div>
          <span className="relative h-1 overflow-hidden rounded-full bg-muted-foreground/20">
            {percent > 0 ? (
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/80"
                style={{ width: `max(${percent}%, 6px)` }}
              />
            ) : null}
          </span>
        </div>
        <ol
          role="list"
          data-thread-details-progress-list
          className="flex max-h-64 flex-col gap-px overflow-y-auto"
        >
          {progress.steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md px-2.5 py-1.5",
                step.status === "running" && "bg-foreground/[0.04]",
              )}
            >
              <StepMarker status={step.status} isWorking={isWorking} />
              <span
                className={cn(
                  "wrap-anywhere leading-4",
                  step.status === "completed" && "text-muted-foreground/70 line-through",
                  step.status === "running" && "font-medium text-foreground",
                  step.status === "pending" && "text-muted-foreground",
                )}
              >
                {step.text}
              </span>
              <span className="sr-only">{STEP_STATUS_LABEL[step.status]}</span>
            </li>
          ))}
        </ol>
      </div>
    </ThreadDetailsSection>
  );
}

function StepMarker({
  status,
  isWorking,
}: {
  readonly status: OrchestrationV2PlanStep["status"];
  readonly isWorking: boolean;
}) {
  if (status === "running" && isWorking) {
    return (
      <span aria-hidden className="flex size-4 items-center justify-center text-foreground/80">
        <Spinner aria-hidden role="presentation" size="md" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 items-center justify-center rounded-full border",
        status === "completed" && "border-transparent bg-foreground/80 text-background",
        status === "running" && "border-foreground/80",
        status === "pending" && "border-muted-foreground/40",
      )}
    >
      {status === "completed" ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
      {status === "running" ? <span className="size-1.5 rounded-full bg-foreground/80" /> : null}
    </span>
  );
}
