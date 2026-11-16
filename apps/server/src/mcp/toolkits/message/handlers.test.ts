import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as MessageHandlers from "./handlers.ts";
import { MessageToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:message");
const chatsProjectId = ProjectId.make("project:chats");

it.effect("proposes a project only from a chat without one", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      ThreadCommandExecutor.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:message"),
        requestNamespace: "provider:message",
        thread: {
          threadId,
          providerSessionId: "provider:message",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed({ ...liveThreadShell(id), projectId: chatsProjectId }),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "",
        isScratchProject: (projectId) => Effect.succeed(projectId === chatsProjectId),
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* MessageToolkit;
      const propose = (name: string) =>
        toolkit.handle("propose_project", { name }).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );

      expect(yield* propose("Pinball Stats")).toMatchObject({
        projectProposal: { name: "Pinball Stats" },
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(MessageHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);

it.effect("tells an agent in a real project that there is nothing to propose", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      ThreadCommandExecutor.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:message"),
        requestNamespace: "provider:message",
        thread: {
          threadId,
          providerSessionId: "provider:message",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "",
        isScratchProject: () => Effect.succeed(false),
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* MessageToolkit;
      const result = yield* toolkit.handle("propose_project", { name: "Pinball Stats" }).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts) => parts.at(-1)?.result),
      );

      expect(result).toMatchObject({ code: "invalid_request" });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(MessageHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
