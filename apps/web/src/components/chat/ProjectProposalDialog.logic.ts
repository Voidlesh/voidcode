import { projectProposalFromToolItem } from "@t3tools/shared/toolOutput";

export interface ProjectProposal {
  readonly itemId: string;
  readonly name: string;
}

interface ProposalRow {
  readonly item: {
    readonly id: string;
    readonly type: string;
    readonly status?: string;
    readonly toolName?: string | null;
    readonly output?: unknown;
  };
}

const MAX_REMEMBERED_DISMISSALS = 50;

/** The agent's latest finished `propose_project` call, unless the user already answered it. */
export function pendingProjectProposal(
  rows: readonly ProposalRow[],
  answeredItemIds: readonly string[],
): ProjectProposal | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const { item } = rows[index]!;
    if (item.type !== "dynamic_tool" || item.status !== "completed") continue;
    const name = projectProposalFromToolItem({ toolName: item.toolName, output: item.output });
    if (name === undefined) continue;
    return answeredItemIds.includes(item.id) ? null : { itemId: item.id, name };
  }
  return null;
}

export function rememberAnsweredProposal(
  answeredItemIds: readonly string[],
  itemId: string,
): readonly string[] {
  return [...answeredItemIds.filter((id) => id !== itemId), itemId].slice(
    -MAX_REMEMBERED_DISMISSALS,
  );
}
