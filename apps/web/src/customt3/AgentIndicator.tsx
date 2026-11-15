import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { CSSProperties } from "react";

import { useEnvironmentProviders } from "../state/environments";
import { useQuietThreadShell, useQuietThreadVisibleTurnItems } from "../state/entities";
import { cn } from "../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { ACTIONS, AGENTS, agentKind, currentAction, type AgentAction } from "./agentActivity";
import "./agentIndicator.css";

const STILL_ACTIONS: ReadonlySet<AgentAction> = new Set([
  "approval",
  "input",
  "waiting",
  "failed",
  "done",
  "idle",
]);
const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

type IndicatorThread = EnvironmentThreadShell;

export interface AgentIndicatorProps {
  /** Thread shell; without it the indicator reads the shell of `threadRef`. */
  thread?: IndicatorThread | null;
  threadRef?: ScopedThreadRef | null;
  /** Provider entry of the thread; without it the environment's providers are consulted. */
  provider?: { readonly driverKind?: string | null } | null;
  /** Known UI state such as "compacting" or "connecting"; terminal and request states win. */
  action?: AgentAction | null;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function AgentIndicator(props: AgentIndicatorProps) {
  return props.provider === undefined ? (
    <ResolvedProviderIndicator {...props} />
  ) : (
    <IndicatorView {...props} />
  );
}

function ResolvedProviderIndicator(props: AgentIndicatorProps) {
  const providers = useEnvironmentProviders();
  const shell = useQuietThreadShell(props.thread ? null : (props.threadRef ?? null));
  const thread = props.thread ?? shell;
  const instanceId = thread?.runtime?.providerInstanceId ?? thread?.modelSelection?.instanceId;
  const entry = thread
    ? providers.get(thread.environmentId)?.find((candidate) => candidate.instanceId === instanceId)
    : undefined;
  return (
    <IndicatorView
      {...props}
      thread={thread}
      provider={entry ? { driverKind: entry.driver } : null}
    />
  );
}

function IndicatorView({
  thread: threadProp,
  threadRef,
  provider,
  action,
  className,
  showLabel = false,
  size = "sm",
}: AgentIndicatorProps) {
  const shell = useQuietThreadShell(threadProp ? null : (threadRef ?? null));
  const thread = threadProp ?? shell;
  const ref = threadRef ?? (thread ? scopeThreadRef(thread.environmentId, thread.id) : null);
  const base = currentAction(thread, null, action);
  const needsItems = base === "working" && thread?.runtime?.status === "running";
  const items = useQuietThreadVisibleTurnItems(needsItems ? ref : null);
  const activity = needsItems ? currentAction(thread, { visibleTurnItems: items }, action) : base;
  const kind = agentKind(thread, provider);
  const agent = AGENTS[kind];
  const [actionLabel, actionColor] = ACTIONS[activity];
  const title = `${agent.label} · ${actionLabel}`;
  const style = {
    "--ct3-agent-color": agent.color,
    "--ct3-action-color": actionColor,
  } as CSSProperties;
  const indicator = (
    <span
      role="img"
      aria-label={title}
      data-ct3-agent=""
      data-agent={kind}
      data-action={activity}
      data-moving={!STILL_ACTIONS.has(activity)}
      style={style}
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className={cn("overflow-visible", size === "sm" ? "size-3" : "size-4")}
      >
        <g data-ct3-rays="" stroke="var(--ct3-agent-color)" strokeWidth={2.5} strokeLinecap="round">
          {RAY_ANGLES.map((angle, index) => (
            <path
              key={angle}
              d="M12 2v3"
              transform={`rotate(${angle} 12 12)`}
              opacity={0.45 + index * 0.075}
            />
          ))}
        </g>
        <circle data-ct3-core="" cx={12} cy={12} r={3.5} fill="var(--ct3-action-color)" />
      </svg>
      {showLabel ? (
        <span aria-hidden className="whitespace-nowrap text-xs text-foreground">
          {title}
        </span>
      ) : null}
    </span>
  );
  if (showLabel) return indicator;
  return (
    <Tooltip>
      <TooltipTrigger render={indicator} />
      <TooltipPopup side="top">{title}</TooltipPopup>
    </Tooltip>
  );
}
