import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useThreadActions } from "~/hooks/useThreadActions";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  type ProjectProposal,
  pendingProjectProposal,
  rememberAnsweredProposal,
} from "./ProjectProposalDialog.logic";

const ANSWERED_PROPOSALS_KEY = "t3code:answered-project-proposals";
const AnsweredProposalsSchema = Schema.Array(Schema.String);
const NO_ANSWERS: readonly string[] = [];

type ProposalRows = Parameters<typeof pendingProjectProposal>[0];

/**
 * Asks whether to turn a Chats thread into a project once the agent proposed one. The question is
 * derived from the thread's `propose_project` call, so it survives a reload until it is answered.
 */
export function ProjectProposalDialog({
  threadRef,
  rows,
  enabled,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly rows: ProposalRows;
  /** False while the agent is still working or the thread is no longer a chat without a project. */
  readonly enabled: boolean;
}) {
  const [answered, setAnswered] = useLocalStorage(
    ANSWERED_PROPOSALS_KEY,
    NO_ANSWERS,
    AnsweredProposalsSchema,
  );
  const proposal = enabled ? pendingProjectProposal(rows, answered) : null;
  const [creating, setCreating] = useState(false);
  const markAnswered = (itemId: string) =>
    setAnswered((current) => rememberAnsweredProposal(current, itemId));

  return (
    <AlertDialog
      open={proposal !== null}
      onOpenChange={(open) => {
        if (!open && proposal !== null && !creating) markAnswered(proposal.itemId);
      }}
    >
      {proposal ? (
        <ProjectProposalPopup
          key={proposal.itemId}
          threadRef={threadRef}
          proposal={proposal}
          onAnswered={() => markAnswered(proposal.itemId)}
          onCreatingChange={setCreating}
        />
      ) : null}
    </AlertDialog>
  );
}

function ProjectProposalPopup({
  threadRef,
  proposal,
  onAnswered,
  onCreatingChange,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly proposal: ProjectProposal;
  readonly onAnswered: () => void;
  readonly onCreatingChange: (creating: boolean) => void;
}) {
  const { turnThreadIntoProject } = useThreadActions();
  const [name, setName] = useState(proposal.name);
  const [busy, setBusy] = useState(false);
  const trimmedName = name.trim();

  const confirm = async () => {
    if (trimmedName.length === 0 || busy) return;
    setBusy(true);
    onCreatingChange(true);
    const result = await turnThreadIntoProject(threadRef, trimmedName);
    onCreatingChange(false);
    setBusy(false);
    if (result._tag === "Success") {
      onAnswered();
      toastManager.add({ type: "success", title: "Project created", description: trimmedName });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not turn this chat into a project",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };

  return (
    <AlertDialogPopup>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Start a project from this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This looks like a real project. The chat moves with its full history into a new folder
            next to your other projects, and the agent carries on there.
          </AlertDialogDescription>
          <label className="mt-2 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Project name
            </span>
            <Input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              aria-label="Project name"
            />
          </label>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
            Not now
          </AlertDialogClose>
          <Button type="submit" disabled={busy || trimmedName.length === 0}>
            {busy && <Spinner size="sm" />}
            Create project
          </Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogPopup>
  );
}
