import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { OfferedSourceControlProviders } from "@t3tools/client-runtime/operations/projects";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type {
  EnvironmentId,
  ScopedThreadRef,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import { ChevronDownIcon, EllipsisIcon, GlobeIcon, LockIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useSourceControlPublishRepositoryAction } from "~/state/sourceControlActions";
import { sourceControlIcon } from "~/sourceControlPresentation";
import { PublishRepositoryDialog } from "../GitActionsControl";
import { ComposerContextLabel } from "../ComposerContextLabel";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { GITHUB_PROVIDER_KIND, resolveGithubPublishPlan } from "./GithubPublishButton.logic";

const GITHUB_ICON = sourceControlIcon(sourceControlClients.get(GITHUB_PROVIDER_KIND));

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

export function GithubPublishButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly gitCwd: string;
  readonly offeredProviders: OfferedSourceControlProviders | undefined;
}) {
  const composerMenuProps = useComposerMenuProps();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogVisibility, setDialogVisibility] =
    useState<SourceControlRepositoryVisibility>("private");
  const openDialog = (visibility: SourceControlRepositoryVisibility) => {
    setDialogVisibility(visibility);
    setDialogOpen(true);
  };
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId: props.environmentId, input: {} }),
  );
  const publishAction = useSourceControlPublishRepositoryAction({
    environmentId: props.environmentId,
    cwd: props.gitCwd,
  });

  const publish = async (visibility: SourceControlRepositoryVisibility) => {
    const plan = resolveGithubPublishPlan({
      discovery: discovery.data ?? null,
      offered: props.offeredProviders,
      workspaceRoot: props.gitCwd,
    });
    if (plan.kind === "dialog") {
      openDialog(visibility);
      return;
    }
    const result = await publishAction.run({
      provider: plan.target.definition.kind,
      repository: plan.repository,
      visibility,
      remoteName: "origin",
      protocol: "auto",
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not create the GitHub repository",
            description: `${errorMessage(squashAtomCommandFailure(result))} Use More options to choose another name or account.`,
          }),
        );
      }
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Published to ${plan.target.definition.label}`,
        description: result.value.repository.nameWithOwner,
      }),
    );
  };

  const pending = publishAction.isPending;
  const disabled = pending || !publishAction.isAllowed;

  return (
    <>
      <span className="inline-flex shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <ComposerControl
                size="xs"
                className="min-w-0 shrink rounded-e-none"
                aria-label="Publish to GitHub as a private repository"
                data-composer-context-control
                disabled={disabled}
                onClick={() => void publish("private")}
              />
            }
          >
            {pending ? <Spinner size="xs" /> : <GITHUB_ICON className="size-3" />}
            <ComposerContextLabel>
              {pending ? "Publishing…" : "Publish to GitHub"}
            </ComposerContextLabel>
          </TooltipTrigger>
          <TooltipPopup>Create a private GitHub repository and push this project</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger
            render={
              <ComposerControl
                size="xs"
                className="rounded-s-none px-1"
                aria-label="More ways to publish"
                data-composer-context-control
                disabled={disabled}
              />
            }
          >
            <ChevronDownIcon aria-hidden="true" className="size-3" />
          </MenuTrigger>
          <MenuPopup side="top" align="start" {...composerMenuProps}>
            <MenuItem onClick={() => void publish("private")}>
              <LockIcon />
              <MenuItemLabel>Private repository</MenuItemLabel>
            </MenuItem>
            <MenuItem onClick={() => void publish("public")}>
              <GlobeIcon />
              <MenuItemLabel>Public repository</MenuItemLabel>
            </MenuItem>
            <MenuItem onClick={() => openDialog("private")}>
              <EllipsisIcon />
              <MenuItemLabel>More options…</MenuItemLabel>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </span>
      <PublishRepositoryDialog
        key={dialogVisibility}
        initialVisibility={dialogVisibility}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        environmentId={props.environmentId}
        threadRef={props.threadRef}
        gitCwd={props.gitCwd}
        offeredProviders={props.offeredProviders}
      />
    </>
  );
}
