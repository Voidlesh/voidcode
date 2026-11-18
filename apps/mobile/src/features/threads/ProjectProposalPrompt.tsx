/* oxlint-disable t3code/no-untranslated-copy -- fork-only copy, English only */
import { useEffect } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import * as Dialog from "../../components/ui/Dialog";
import { useSelectedThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { pendingProjectProposal } from "./projectProposal";
import { canTurnThreadIntoProject, turnThreadIntoProject } from "./turnThreadIntoProject";

/** Each proposal is asked once per app session; the sidebar's "Turn into project" stays available. */
const askedProposalIds = new Set<string>();

/** Asks whether to turn a Chats thread into a project once the agent proposed one. */
export function ProjectProposalPrompt(props: {
  readonly thread: EnvironmentThreadShell;
  readonly busy: boolean;
}) {
  const { thread, busy } = props;
  const rows = useSelectedThreadVisibleTurnItems();
  const proposal =
    busy || !canTurnThreadIntoProject(thread)
      ? null
      : pendingProjectProposal(rows, askedProposalIds);
  const proposalId = proposal?.itemId ?? null;
  const proposalName = proposal?.name ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens an imperative native dialog
  useEffect(() => {
    if (proposalId === null || proposalName === null || askedProposalIds.has(proposalId)) return;
    askedProposalIds.add(proposalId);
    Dialog.prompt({
      title: "Start a project from this chat?",
      message:
        "This looks like a real project. The chat moves with its full history into a new folder next to your other projects.",
      initialValue: proposalName,
      confirmText: "Create project",
      cancelText: "Not now",
      onConfirm: (value) => {
        void turnThreadIntoProject(thread, value.trim() || proposalName);
      },
    });
  }, [proposalId, proposalName, thread]);

  return null;
}
