import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import type { ThreadProgress } from "./threadProgress.logic";

const STEP_STATUS_LABEL: Record<OrchestrationV2PlanStep["status"], string> = {
  pending: "To do",
  running: "In progress",
  completed: "Done",
};

/** The agent's own checklist: a bar for how far it is, then every step with its state. */
export function ThreadDetailsProgress({ progress }: { readonly progress: ThreadProgress }) {
  const percent = Math.round((progress.done / progress.total) * 100);
  return (
    <ThreadDetailsSection
      headingId="thread-details-progress-heading"
      title="Progress"
      showHeading={false}
    >
      <div className="flex flex-col text-xs">
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} steps done`}
          className="grid h-6 grid-cols-[auto_minmax(3rem,1fr)_auto] items-center gap-x-3 px-2.5"
        >
          <span
            className={cn(
              "min-w-0 max-w-36 truncate",
              progress.current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {progress.current?.text ?? "Done"}
          </span>
          <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
            {percent > 0 ? (
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/80"
                style={{ width: `max(${percent}%, 6px)` }}
              />
            ) : null}
          </span>
          <span className="text-end font-medium tabular-nums text-foreground/80">
            {progress.done}/{progress.total}
          </span>
        </div>
        <ol
          role="list"
          data-thread-details-progress-list
          className="mt-0.5 flex max-h-56 flex-col overflow-y-auto"
        >
          {progress.steps.map((step) => (
            <li key={step.id} className="flex min-h-6 items-start gap-2 rounded-lg px-2.5 py-1">
              <StepMarker status={step.status} />
              <span
                className={cn(
                  "min-w-0 line-clamp-2 leading-4",
                  step.status === "completed" && "text-muted-foreground line-through",
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

function StepMarker({ status }: { readonly status: OrchestrationV2PlanStep["status"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-px flex size-4 shrink-0 items-center justify-center rounded-full border",
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
