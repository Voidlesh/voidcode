import {
  CommandId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { threadHasUnfinishedWork } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectService from "./ProjectService.ts";

export class ScratchThreadPromotionError extends Schema.TaggedError<ScratchThreadPromotionError>()(
  "ScratchThreadPromotionError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class ScratchThreadPromotion extends Context.Service<
  ScratchThreadPromotion,
  {
    /**
     * Turns a Chats thread's folder into a project and moves every thread working in that
     * folder into it. Without `name` the folder becomes the project in place; with one the files
     * move into a new folder beside the user's other projects. Running it again finishes a
     * partial move.
     */
    readonly promote: (input: {
      readonly threadId: ThreadId;
      readonly name?: string;
    }) => Effect.Effect<{ readonly projectId: ProjectId }, ScratchThreadPromotionError>;
  }
>()("t3/project/ScratchThreadPromotion") {}

const detailOf = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? typeof cause.message === "string"
      ? cause.message
      : ""
    : "";

const make = Effect.gen(function* () {
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const random = yield* SecureRandom.SecureRandom;
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const realPath = (folder: string) =>
    fileSystem.realPath(folder).pipe(Effect.orElseSucceed(() => folder));

  const fail = (reason: string) => (cause: unknown) =>
    new ScratchThreadPromotionError({ reason, cause });
  const failWithDetail = (reason: string) => (cause: unknown) => {
    const detail = detailOf(cause);
    return new ScratchThreadPromotionError({
      reason: detail.length > 0 ? `${reason} ${detail}` : reason,
      cause,
    });
  };

  const promote: ScratchThreadPromotion["Service"]["promote"] = Effect.fn(
    "ScratchThreadPromotion.promote",
  )(function* (input) {
    const thread = yield* threads.getThreadShell(input.threadId).pipe(
      Effect.mapError(fail("Could not read the thread.")),
      Effect.filterOrFail(
        (shell) => shell !== null,
        () => new ScratchThreadPromotionError({ reason: "Thread not found." }),
      ),
    );
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.mapError(fail("Could not read the thread's project.")));
    const folder = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
    const scratchRoot = Option.getOrUndefined(yield* managedFolders.scratchRoot);
    const isScratch = yield* managedFolders.isScratchProject(thread.projectId);
    const relocatedName = input.name;
    // A relocated thread already lives in an ordinary project; asking again changes nothing.
    if (relocatedName !== undefined && !isScratch) return { projectId: thread.projectId };
    const inScratchFolder =
      folder !== undefined &&
      scratchRoot !== undefined &&
      (yield* realPath(path.dirname(folder))) === (yield* realPath(scratchRoot));
    // A thread already rooted at its folder is a partial earlier promotion; finish it.
    const alreadyPromoted =
      Option.isSome(project) && project.value.workspaceRoot === folder && !isScratch;
    // A relocation that stopped after moving the thread's folder leaves it pointing at the new
    // project's root while still in Chats.
    const relocatedTarget =
      relocatedName !== undefined && folder !== undefined && isScratch && !inScratchFolder
        ? yield* projects.getByWorkspaceRoot(folder).pipe(
            Effect.flatMap((owner) =>
              Option.isSome(owner)
                ? managedFolders
                    .isScratchProject(owner.value.id)
                    .pipe(Effect.map((scratch) => (scratch ? undefined : owner.value)))
                : Effect.undefined,
            ),
            Effect.mapError(fail("Could not read the project of this folder.")),
          )
        : undefined;
    if (
      folder === undefined ||
      !(
        relocatedTarget !== undefined ||
        (inScratchFolder && (isScratch || (relocatedName === undefined && alreadyPromoted)))
      )
    ) {
      return yield* new ScratchThreadPromotionError({
        reason: "Only a Chats thread with its own folder can become a project.",
      });
    }

    const snapshot = yield* Effect.flatten(
      threads.readShellSnapshot({ worktreePath: folder }),
    ).pipe(Effect.mapError(fail("Could not read the threads in this folder.")));
    const moveSet = new Map<ThreadId, OrchestrationV2ThreadShell>();
    if (isScratch) moveSet.set(thread.id, thread);
    const everyThreadInFolder = [...snapshot.threads, ...snapshot.archivedThreads];
    for (const candidate of everyThreadInFolder) {
      if (yield* managedFolders.isScratchProject(candidate.projectId)) {
        moveSet.set(candidate.id, candidate);
      }
    }

    for (const candidate of moveSet.values()) {
      const records = yield* threads
        .getThreadRecords(candidate.id, ["runs", "runtimeRequests"], { turnItemTypes: [] })
        .pipe(Effect.mapError(fail(`Could not read "${candidate.title}".`)));
      if (threadHasUnfinishedWork(records)) {
        return yield* new ScratchThreadPromotionError({
          reason: `"${candidate.title}" is still working. Finish or stop it first.`,
        });
      }
    }

    // The copy cleans up after itself when interrupted; only the thread moves must not be cut off.
    const destination =
      relocatedName === undefined
        ? undefined
        : relocatedTarget === undefined
          ? yield* managedFolders
              .relocateScratchFolder({ name: relocatedName, sourceFolder: folder })
              .pipe(
                Effect.map(({ projectId, workspaceRoot }) => ({ projectId, workspaceRoot })),
                Effect.mapError(fail("Could not create the project folder.")),
              )
          : { projectId: relocatedTarget.id, workspaceRoot: relocatedTarget.workspaceRoot };

    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const projectId = destination?.projectId ?? (yield* createProject(thread.title, folder));
        yield* scheduledTasks
          .moveThreadTasks({ threadIds: [...moveSet.keys()], projectId })
          .pipe(Effect.mapError(fail("Could not move the thread's scheduled tasks.")));
        for (const candidate of moveSet.values()) {
          if (destination !== undefined && candidate.worktreePath !== destination.workspaceRoot) {
            yield* threads
              .dispatch({
                type: "thread.metadata.update",
                commandId: CommandId.make(`scratch-relocation:${yield* randomId}`),
                threadId: candidate.id,
                worktreePath: destination.workspaceRoot,
                expectedWorktreePath: candidate.worktreePath,
              })
              .pipe(Effect.mapError(failWithDetail(`Could not move "${candidate.title}".`)));
          }
          yield* threads
            .dispatch({
              type: "thread.project.adopt-folder",
              commandId: CommandId.make(`scratch-promotion:${yield* randomId}`),
              threadId: candidate.id,
              projectId,
            })
            .pipe(Effect.mapError(failWithDetail(`Could not move "${candidate.title}".`)));
        }
        return { projectId };
      }),
    );
  });

  const randomId = random.uuidV4();

  // bootstrap returns the project that already owns the folder, so retries reuse it.
  const createProject = Effect.fn("ScratchThreadPromotion.createProject")(function* (
    title: string,
    workspaceRoot: string,
  ) {
    const id = yield* randomId;
    return yield* projects
      .bootstrap({
        commandId: CommandId.make(`scratch-promotion-project:${id}`),
        projectId: ProjectId.make(id),
        title,
        workspaceRoot,
      })
      .pipe(
        Effect.map(({ project }) => project.id),
        // bootstrap reads before locking; racing creates return the winner in a conflict.
        Effect.catchTags({
          ProjectConflictError: (conflict) => Effect.succeed(conflict.conflictingProjectId),
        }),
        Effect.mapError(fail("Could not create the project.")),
      );
  });

  return ScratchThreadPromotion.of({ promote });
});

export const layer = Layer.effect(ScratchThreadPromotion, make);
