import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  GITHUB_PROVIDER_KIND,
  resolveGithubPublishPlan,
  shouldOfferGithubPublish,
} from "./GithubPublishButton.logic";
import { shouldShowComposerContextStrip } from "../BranchToolbar.logic";

const offerable = {
  isScratchProject: false,
  embedded: false,
  isProviderSubagent: false,
  canWriteSourceControl: true,
  worktreePath: null,
  gitStatus: { isRepo: true, hasPrimaryRemote: false },
};

describe("shouldOfferGithubPublish", () => {
  it("offers a plain repository without a remote", () => {
    expect(shouldOfferGithubPublish(offerable)).toBe(true);
  });

  it.each([
    ["a chat without a project", { isScratchProject: true }],
    ["an embedded side chat", { embedded: true }],
    ["a provider subagent", { isProviderSubagent: true }],
    ["a read-only session", { canWriteSourceControl: false }],
    ["a thread in a worktree", { worktreePath: "/repo/.t3/worktrees/a" }],
    ["unknown git status", { gitStatus: null }],
    [
      "a folder that is not a repository",
      { gitStatus: { isRepo: false, hasPrimaryRemote: false } },
    ],
    [
      "a repository that already has a remote",
      { gitStatus: { isRepo: true, hasPrimaryRemote: true } },
    ],
  ])("stays hidden for %s", (_name, override) => {
    expect(shouldOfferGithubPublish({ ...offerable, ...override })).toBe(false);
  });
});

describe("shouldShowComposerContextStrip", () => {
  const base = {
    isDraftHeroState: false,
    persistInActiveThreads: false,
    hasActiveProject: true,
    isGitRepo: true,
    showEnvironmentIndicator: false,
    offersGithubPublish: false,
  };

  it("shows the strip for the publish offer even when the strip is not persisted", () => {
    expect(shouldShowComposerContextStrip(base)).toBe(false);
    expect(shouldShowComposerContextStrip({ ...base, offersGithubPublish: true })).toBe(true);
  });

  it("never shows it without a project", () => {
    expect(
      shouldShowComposerContextStrip({
        ...base,
        hasActiveProject: false,
        offersGithubPublish: true,
      }),
    ).toBe(false);
  });
});

const discoveryWith = (
  auth: { status: "authenticated" | "unauthenticated"; account: string | null },
  kind = GITHUB_PROVIDER_KIND,
): SourceControlDiscoveryResult => ({
  versionControlSystems: [],
  sourceControlProviders: [
    {
      kind,
      label: "GitHub",
      status: "available",
      version: Option.none(),
      installHint: "Install gh",
      detail: Option.none(),
      auth: {
        status: auth.status,
        account: Option.fromNullishOr(auth.account),
        host: Option.none(),
        detail: Option.none(),
      },
    },
  ],
});

describe("resolveGithubPublishPlan", () => {
  it("publishes directly under the signed-in account, named after the folder", () => {
    const plan = resolveGithubPublishPlan({
      discovery: discoveryWith({ status: "authenticated", account: "octo" }),
      offered: undefined,
      workspaceRoot: "C:\\Dev\\my-app",
    });
    expect(plan.kind).toBe("direct");
    if (plan.kind === "direct") expect(plan.repository).toBe("octo/my-app");
  });

  it("falls back to the wizard when GitHub is not signed in or not yet discovered", () => {
    expect(
      resolveGithubPublishPlan({
        discovery: discoveryWith({ status: "unauthenticated", account: null }),
        offered: undefined,
        workspaceRoot: "/dev/my-app",
      }),
    ).toEqual({ kind: "dialog" });
    expect(
      resolveGithubPublishPlan({
        discovery: null,
        offered: undefined,
        workspaceRoot: "/dev/my-app",
      }),
    ).toEqual({ kind: "dialog" });
  });
});
