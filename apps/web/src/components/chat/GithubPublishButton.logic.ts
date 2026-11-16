import {
  getNewProjectPublishTargets,
  getNewProjectRepository,
  type NewProjectPublishTarget,
  type OfferedSourceControlProviders,
} from "@t3tools/client-runtime/operations/projects";
import { SourceControlProviderKind, type SourceControlDiscoveryResult } from "@t3tools/contracts";

export const GITHUB_PROVIDER_KIND = SourceControlProviderKind.make("github");

/** Only a checkout that is a git repository, with no remote yet, can be published. */
export function shouldOfferGithubPublish(input: {
  isScratchProject: boolean;
  embedded: boolean;
  isProviderSubagent: boolean;
  canWriteSourceControl: boolean;
  worktreePath: string | null;
  gitStatus: { readonly isRepo: boolean; readonly hasPrimaryRemote: boolean } | null;
}): boolean {
  return (
    !input.isScratchProject &&
    !input.embedded &&
    !input.isProviderSubagent &&
    input.canWriteSourceControl &&
    input.worktreePath === null &&
    input.gitStatus !== null &&
    input.gitStatus.isRepo &&
    !input.gitStatus.hasPrimaryRemote
  );
}

export type GithubPublishPlan =
  | {
      readonly kind: "direct";
      readonly target: NewProjectPublishTarget;
      readonly repository: string;
    }
  | { readonly kind: "dialog" };

/** One click publishes only when GitHub is offered and signed in; otherwise the wizard guides the user. */
export function resolveGithubPublishPlan(input: {
  discovery: SourceControlDiscoveryResult | null;
  offered: OfferedSourceControlProviders | undefined;
  workspaceRoot: string;
}): GithubPublishPlan {
  const target = getNewProjectPublishTargets(input.discovery, input.offered).find(
    (candidate) => candidate.definition.kind === GITHUB_PROVIDER_KIND,
  );
  if (target === undefined) return { kind: "dialog" };
  const repository = getNewProjectRepository(target, input.workspaceRoot);
  return repository.endsWith("/") || repository.length === 0
    ? { kind: "dialog" }
    : { kind: "direct", target, repository };
}
