import {
  CommandId,
  GitCommandError,
  type GitManagerServiceError,
  ProjectId,
  type ThreadId,
  VcsProcessSpawnError,
} from "@t3tools/contracts";
import { foldLatinDiacritics, newProjectFolderName } from "@t3tools/shared/path";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectService from "./ProjectService.ts";

export class ScratchUnavailableError extends Schema.TaggedError<ScratchUnavailableError>()(
  "ScratchUnavailableError",
  {
    baseDir: Schema.String,
    repositoryRoot: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    if (this.repositoryRoot === undefined) {
      return "Threads without a project are not available on this environment.";
    }
    return `Threads without a project are off because the T3 home ${this.baseDir} is inside the Git repository ${this.repositoryRoot}. If that repository was created by mistake, move ${this.repositoryRoot}/.git out of the way; otherwise point T3CODE_HOME (or --base-dir) at a folder outside it. Then restart T3 Code.`;
  }
}

export class ScratchFolderError extends Schema.TaggedError<ScratchFolderError>()(
  "ScratchFolderError",
  {
    folder: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the folder for threads without a project.";
  }
}

export class ScratchProjectError extends Schema.TaggedError<ScratchProjectError>()(
  "ScratchProjectError",
  {
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the project for threads without a project.";
  }
}

/** Where No project threads keep their folders, whether or not this T3 home allows them. */
export const scratchFolderRoot = (baseDir: string, path: Path.Path) =>
  path.resolve(baseDir, "scratch");

export type ScratchError = ScratchUnavailableError | ScratchFolderError | ScratchProjectError;

// The spawner checks cwd before spawning, so NotFound from spawn itself means a missing executable.
const isMissingExecutable = (cause: unknown) =>
  PlatformError.isPlatformError(cause) &&
  cause.reason._tag === "NotFound" &&
  cause.reason.method === "spawn";

const isGitCommandError = Schema.is(GitCommandError);

export class NamedProjectFolderError extends Schema.TaggedError<NamedProjectFolderError>()(
  "NamedProjectFolderError",
  {
    folder: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return isGitCommandError(this.cause) && isMissingExecutable(this.cause.cause)
      ? "Git isn't installed on this machine. Install Git to create a project."
      : "Failed to create the project folder.";
  }
}

export class NamedProjectCreateError extends Schema.TaggedError<NamedProjectCreateError>()(
  "NamedProjectCreateError",
  {
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to create the project.";
  }
}

export type NamedProjectError = NamedProjectFolderError | NamedProjectCreateError;

export class ManagedProjectFolders extends Context.Service<
  ManagedProjectFolders,
  {
    readonly scratchRoot: Effect.Effect<Option.Option<string>>;
    readonly ensureScratchProject: Effect.Effect<{ readonly projectId: ProjectId }, ScratchError>;
    readonly isScratchProject: (projectId: ProjectId) => Effect.Effect<boolean>;
    readonly folderForThread: (input: {
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<Option.Option<string>, ScratchFolderError>;
    readonly namedProjectsRoot: string;
    /** Removes failed/cancelled creations' folders only while no project owns them. */
    readonly createNamedProject: (input: { readonly name: string }) => Effect.Effect<
      {
        readonly projectId: ProjectId;
        readonly workspaceRoot: string;
        readonly commitError?: string;
      },
      NamedProjectError
    >;
    /**
     * Copies a chat's folder into a new project folder named `name`, next to the user's other
     * projects, and makes it a Git repository and a project. The source keeps its files and gains a
     * marker naming the copy, so the caller can move threads first and a retry finishes the move.
     */
    readonly relocateScratchFolder: (input: {
      readonly name: string;
      readonly sourceFolder: string;
    }) => Effect.Effect<
      {
        readonly projectId: ProjectId;
        readonly workspaceRoot: string;
        readonly commitError?: string;
      },
      NamedProjectError
    >;
  }
>()("t3/project/ManagedProjectFolders") {}

const folderWords = (text: string) =>
  foldLatinDiacritics(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/, "");

const ICON_BACKGROUNDS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#059669",
  "#0d9488",
  "#0891b2",
  "#0284c7",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#9333ea",
  "#c026d3",
  "#db2777",
  "#e11d48",
] as const;

const MAX_NAMED_FOLDER_ATTEMPTS = 100;

// Written into a chat's folder once its files are copied, so a retry reuses the copy.
const RELOCATION_MARKER = ".t3-relocated-to";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ProjectFaviconResolver finds assets/icon.svg on every clone.
function namedProjectIconSvg(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase() ||
    Array.from(name.trim())[0] ||
    "?";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  const background = ICON_BACKGROUNDS[hash % ICON_BACKGROUNDS.length];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `  <rect width="64" height="64" rx="14" fill="${background}"/>`,
    `  <text x="32" y="32" dy="0.35em" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="${initials.length > 1 ? 26 : 32}" font-weight="600" fill="#ffffff">${escapeXml(initials)}</text>`,
    `</svg>`,
    "",
  ].join("\n");
}

function namedProjectReadme(name: string): string {
  return [
    `<img src="assets/icon.svg" width="64" height="64" alt="">`,
    "",
    `# ${name}`,
    "",
    "Created in [T3 Code](https://t3.codes).",
    "",
  ].join("\n");
}

function describeCommitFailure(stderr: string): string {
  if (/identity unknown|tell me who you are|no (name|email) was given/i.test(stderr)) {
    return "Git has no name or email on this machine. Set user.name and user.email, then commit.";
  }
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "Git could not make the first commit.";
}

const isVcsProcessSpawnError = Schema.is(VcsProcessSpawnError);

const isGitMissing = (error: GitManagerServiceError) =>
  error._tag === "GitManagerError" &&
  isVcsProcessSpawnError(error.cause) &&
  PlatformError.isPlatformError(error.cause.cause) &&
  error.cause.cause.reason._tag === "NotFound";

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const gitWorkflow = yield* GitWorkflow.GitWorkflowService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projects = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;

  // Non-recursive mkdir atomically claims a name; racers move on after AlreadyExists.
  const claimFreeFolder = Effect.fnUntraced(function* <E>(
    folderFor: (attempt: number) => Effect.Effect<Option.Option<string>, E>,
    onError: (folder: string, cause: PlatformError.PlatformError) => E,
  ) {
    for (let attempt = 1; ; attempt++) {
      const folder = yield* folderFor(attempt);
      if (Option.isNone(folder)) return folder;
      const claimed = yield* fileSystem.makeDirectory(folder.value).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.mapError((cause) => onError(folder.value, cause)),
      );
      if (claimed) return folder;
    }
  });

  // Scratch inside a checkout would inherit its git status and checkpoints; require a data dir outside work trees.
  const [probe, invalidate] = yield* Effect.cachedInvalidateWithTTL(
    gitWorkflow.repositoryRoot(config.baseDir).pipe(
      Effect.catchIf(isGitMissing, () => Effect.succeed(null)),
      Effect.flatMap(
        (repositoryRoot): Effect.Effect<Result.Result<string, ScratchUnavailableError>> => {
          if (repositoryRoot === null) {
            return Effect.succeed(Result.succeed(scratchFolderRoot(config.baseDir, path)));
          }
          const unavailable = new ScratchUnavailableError({
            baseDir: config.baseDir,
            repositoryRoot,
          });
          return Effect.logWarning(unavailable.message).pipe(Effect.as(Result.fail(unavailable)));
        },
      ),
    ),
    // A failed git check (say, a timeout on a busy machine) is not an answer; ask again next time.
    Exit.match({ onSuccess: () => Duration.infinity, onFailure: () => Duration.zero }),
  );
  const scratchProbe = probe.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.succeed(Result.fail(new ScratchUnavailableError({ baseDir: config.baseDir }))),
    ),
    Effect.onInterrupt(() => invalidate),
  );
  // A symlinked scratch folder lets the No project live at either the link or its target.
  const scratchProjectRoot = (root: string) =>
    fileSystem.realPath(root).pipe(
      Effect.flatMap((target) =>
        target === root
          ? Effect.succeed(root)
          : projects
              .getByWorkspaceRoot(target)
              .pipe(Effect.map((project) => (Option.isSome(project) ? target : root))),
      ),
      Effect.orElseSucceed(() => root),
    );
  const scratchRoot = scratchProbe.pipe(
    Effect.flatMap((probed) =>
      Result.isSuccess(probed)
        ? scratchProjectRoot(probed.success).pipe(Effect.asSome)
        : Effect.succeedNone,
    ),
  );

  const makeScratchFolder = (folder: string) =>
    fileSystem
      .makeDirectory(folder, { recursive: true })
      .pipe(Effect.mapError((cause) => new ScratchFolderError({ folder, cause })));

  const ensureScratchProject: ManagedProjectFolders["Service"]["ensureScratchProject"] = Effect.gen(
    function* () {
      const probedRoot = yield* scratchProbe.pipe(Effect.flatMap(Effect.fromResult));
      yield* makeScratchFolder(probedRoot);
      const workspaceRoot = yield* scratchProjectRoot(probedRoot);
      const id = yield* random
        .uuidV4()
        .pipe(Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })));
      const bootstrapped = yield* projects
        .bootstrap({
          commandId: CommandId.make(`scratch-project:${id}`),
          projectId: ProjectId.make(id),
          title: "Chats",
          workspaceRoot,
        })
        .pipe(
          // bootstrap reads before locking; racing creates return the winner in a conflict.
          Effect.catchTags({
            ProjectConflictError: (conflict) =>
              Effect.succeed({
                project: { id: conflict.conflictingProjectId },
                created: false,
              }),
          }),
          Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })),
        );
      if (bootstrapped.created) {
        // Set once at create, so a user's own icon choice is never overwritten.
        yield* projects
          .update({
            commandId: CommandId.make(`scratch-project-icon:${id}`),
            projectId: bootstrapped.project.id,
            projectIcon: { kind: "lucide", name: "message-square-dashed", color: "gray" },
          })
          .pipe(Effect.mapError((cause) => new ScratchProjectError({ workspaceRoot, cause })));
      }
      return { projectId: bootstrapped.project.id };
    },
  );

  const isScratchRoot = (projectId: ProjectId, root: string) =>
    projects.getById(projectId).pipe(
      Effect.map(
        Option.exists((project) => path.resolve(project.workspaceRoot) === path.resolve(root)),
      ),
      Effect.orElseSucceed(() => false),
    );

  const isScratchProject: ManagedProjectFolders["Service"]["isScratchProject"] = (projectId) =>
    scratchRoot.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (root) => isScratchRoot(projectId, root),
        }),
      ),
    );

  const folderForThread: ManagedProjectFolders["Service"]["folderForThread"] = Effect.fn(
    "ManagedProjectFolders.folderForThread",
  )(function* (input) {
    const root = yield* scratchRoot;
    if (Option.isNone(root)) return Option.none();
    if (!(yield* isScratchRoot(input.projectId, root.value))) return Option.none();
    const date = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
    const words = folderWords(input.text);
    const id = input.threadId.toLowerCase().replace(/[^a-z0-9]/g, "");
    const folderFor = (idPart: string) =>
      path.join(root.value, [date, words, idPart].filter(Boolean).join("-"));
    yield* makeScratchFolder(root.value);
    const fullFolder = folderFor(id);
    return yield* claimFreeFolder(
      (attempt) =>
        attempt === 1
          ? Effect.succeedSome(folderFor(id.slice(-8)))
          : attempt === 2
            ? Effect.succeedSome(fullFolder)
            : random.uuidV4().pipe(
                Effect.map((uuid) => Option.some(`${fullFolder}-${uuid.slice(0, 8)}`)),
                Effect.mapError((cause) => new ScratchFolderError({ folder: fullFolder, cause })),
              ),
      (folder, cause) => new ScratchFolderError({ folder, cause }),
    );
  });

  const namedProjectsRoot = path.resolve(config.baseDir, "projects");

  const claimNamedFolder = Effect.fn("ManagedProjectFolders.claimNamedFolder")(function* (
    name: string,
    parent: string = namedProjectsRoot,
  ) {
    yield* fileSystem
      .makeDirectory(parent, { recursive: true })
      .pipe(Effect.mapError((cause) => new NamedProjectFolderError({ folder: parent, cause })));
    const folderName = newProjectFolderName(name);
    const claimed = yield* claimFreeFolder(
      (attempt) =>
        Effect.succeed(
          attempt > MAX_NAMED_FOLDER_ATTEMPTS
            ? Option.none()
            : Option.some(
                path.join(parent, attempt === 1 ? folderName : `${folderName}-${attempt}`),
              ),
        ),
      (folder, cause) => new NamedProjectFolderError({ folder, cause }),
    );
    if (Option.isSome(claimed)) return claimed.value;
    return yield* new NamedProjectFolderError({
      folder: path.join(parent, folderName),
      cause: `Every folder name for "${folderName}" is taken.`,
    });
  });

  const isDirectory = (folder: string) =>
    fileSystem.stat(folder).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  // Folders holding the user's projects, most projects first; filesystem and managed roots do not count.
  const projectParents = Effect.fn("ManagedProjectFolders.projectParents")(function* () {
    const shells = yield* projects.listShells().pipe(Effect.orElseSucceed(() => []));
    const managedRoot = path.resolve(config.baseDir);
    const counts = new Map<string, number>();
    for (const shell of shells) {
      const parent = path.dirname(path.resolve(shell.workspaceRoot));
      const isFilesystemRoot = path.dirname(parent) === parent;
      const isManaged = parent === managedRoot || parent.startsWith(managedRoot + path.sep);
      if (isFilesystemRoot || isManaged) continue;
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return [...counts].toSorted(([, left], [, right]) => right - left).map(([parent]) => parent);
  });

  // The folder holding most of the user's projects (their dev folder); chats move in beside them.
  const projectsParent = Effect.fn("ManagedProjectFolders.projectsParent")(function* () {
    for (const parent of yield* projectParents()) {
      if (yield* isDirectory(parent)) return parent;
    }
    return namedProjectsRoot;
  });

  const scaffoldRepository = Effect.fn("ManagedProjectFolders.scaffoldRepository")(function* (
    cwd: string,
    name: string,
    options?: { readonly preserveExisting?: boolean },
  ) {
    const branch =
      (yield* git
        .readConfigValue(cwd, "init.defaultBranch")
        .pipe(Effect.orElseSucceed(() => null))) ?? "main";
    yield* git.execute({
      operation: "ManagedProjectFolders.init",
      cwd,
      args: ["init", `--initial-branch=${branch}`],
      timeoutMs: 10_000,
    });
    // A copied chat may already have its own README or icon; those stay as they are.
    const written: string[] = [];
    const writeScaffoldFile = Effect.fnUntraced(function* (relativePath: string, content: string) {
      const target = path.join(cwd, relativePath);
      if (options?.preserveExisting === true && (yield* fileSystem.exists(target))) return;
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* fileSystem.writeFileString(target, content);
      written.push(relativePath);
    });
    yield* writeScaffoldFile("README.md", namedProjectReadme(name));
    yield* writeScaffoldFile("assets/icon.svg", namedProjectIconSvg(name));
    if (written.length === 0) return undefined;
    // Force explicit filenames so global ignore rules cannot drop them, and keep
    // core.safecrlf=true from refusing the LF files under CRLF conversion.
    yield* git.execute({
      operation: "ManagedProjectFolders.add",
      cwd,
      args: ["-c", "core.safecrlf=false", "add", "--force", "--", ...written],
      timeoutMs: 10_000,
    });
    return yield* git
      .execute({
        operation: "ManagedProjectFolders.commit",
        cwd,
        args: ["commit", "--message", "Initial commit"],
        allowNonZeroExit: true,
        timeoutMs: 30_000,
      })
      .pipe(
        Effect.map((result) =>
          result.exitCode === 0 ? undefined : describeCommitFailure(result.stderr),
        ),
        Effect.catch((error) => Effect.succeed(error.message)),
      );
  });

  const createNamedProject: ManagedProjectFolders["Service"]["createNamedProject"] = Effect.fn(
    "ManagedProjectFolders.createNamedProject",
  )(function* (input) {
    const workspaceRoot = yield* claimNamedFolder(input.name);
    const removeFolder = fileSystem.remove(workspaceRoot, { recursive: true }).pipe(Effect.ignore);
    const prepared = yield* Effect.all([
      scaffoldRepository(workspaceRoot, input.name).pipe(
        Effect.mapError((cause) => new NamedProjectFolderError({ folder: workspaceRoot, cause })),
      ),
      random
        .uuidV4()
        .pipe(Effect.mapError((cause) => new NamedProjectCreateError({ workspaceRoot, cause }))),
    ]).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : removeFolder)));
    const [commitError, id] = prepared;
    const project = yield* registerProject({ id, name: input.name, workspaceRoot, removeFolder });
    return {
      projectId: project.id,
      workspaceRoot,
      ...(commitError === undefined ? {} : { commitError }),
    };
  });

  const registerProject = (input: {
    readonly id: string;
    readonly name: string;
    readonly workspaceRoot: string;
    readonly removeFolder: Effect.Effect<void>;
  }) =>
    projects
      .create({
        commandId: CommandId.make(`named-project:${input.id}`),
        projectId: ProjectId.make(input.id),
        title: input.name,
        workspaceRoot: input.workspaceRoot,
      })
      .pipe(
        // Re-check ownership before deleting rejected creations; interruption after commit or conflicts can leave an owner.
        Effect.tapError((error) =>
          error._tag === "ProjectConflictError"
            ? Effect.void
            : projects.getByWorkspaceRoot(input.workspaceRoot).pipe(
                Effect.flatMap((owner) =>
                  Option.isNone(owner) ? input.removeFolder : Effect.void,
                ),
                Effect.ignore,
              ),
        ),
        Effect.mapError(
          (cause) => new NamedProjectCreateError({ workspaceRoot: input.workspaceRoot, cause }),
        ),
      );

  // The agent can write the chat folder, so a marker only counts while it names a git folder
  // that sits where a relocation would have put it.
  const readRelocationTarget = Effect.fn("ManagedProjectFolders.readRelocationTarget")(function* (
    marker: string,
  ) {
    const text = yield* fileSystem.readFileString(marker).pipe(Effect.orElseSucceed(() => ""));
    const target = text.trim();
    if (target.length === 0 || !path.isAbsolute(target)) return null;
    const allowedParents = [namedProjectsRoot, ...(yield* projectParents())];
    if (!allowedParents.includes(path.dirname(path.resolve(target)))) return null;
    const isRepository = yield* fileSystem
      .exists(path.join(target, ".git"))
      .pipe(Effect.orElseSucceed(() => false));
    return isRepository && (yield* isDirectory(target)) ? target : null;
  });

  const copyIntoProjectFolder = Effect.fn("ManagedProjectFolders.copyIntoProjectFolder")(
    function* (input: { readonly name: string; readonly sourceFolder: string }) {
      const parent = yield* projectsParent();
      // A dev folder we cannot write to must not block the move; the managed root always works.
      const workspaceRoot = yield* claimNamedFolder(input.name, parent).pipe(
        Effect.catchTags({
          NamedProjectFolderError: (error) =>
            parent === namedProjectsRoot
              ? Effect.fail(error)
              : claimNamedFolder(input.name, namedProjectsRoot),
        }),
      );
      const removeFolder = fileSystem
        .remove(workspaceRoot, { recursive: true })
        .pipe(Effect.ignore);
      const commitError = yield* Effect.gen(function* () {
        yield* fileSystem.copy(input.sourceFolder, workspaceRoot, { overwrite: true });
        yield* fileSystem.remove(path.join(workspaceRoot, RELOCATION_MARKER), { force: true });
        // A chat that already made its own repository keeps it, history included.
        const hasRepository = yield* fileSystem.exists(path.join(workspaceRoot, ".git"));
        const failure = hasRepository
          ? undefined
          : yield* scaffoldRepository(workspaceRoot, input.name, { preserveExisting: true });
        yield* fileSystem.writeFileString(
          path.join(input.sourceFolder, RELOCATION_MARKER),
          workspaceRoot,
        );
        return failure;
      }).pipe(
        Effect.mapError((cause) => new NamedProjectFolderError({ folder: workspaceRoot, cause })),
        Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : removeFolder)),
      );
      return { workspaceRoot, commitError };
    },
  );

  const relocateScratchFolder: ManagedProjectFolders["Service"]["relocateScratchFolder"] =
    Effect.fn("ManagedProjectFolders.relocateScratchFolder")(function* (input) {
      const resumed = yield* readRelocationTarget(path.join(input.sourceFolder, RELOCATION_MARKER));
      const copied =
        resumed === null
          ? yield* copyIntoProjectFolder(input)
          : { workspaceRoot: resumed, commitError: undefined };
      const { workspaceRoot, commitError } = copied;
      const owner = yield* projects
        .getByWorkspaceRoot(workspaceRoot)
        .pipe(Effect.mapError((cause) => new NamedProjectCreateError({ workspaceRoot, cause })));
      if (Option.isSome(owner)) return { projectId: owner.value.id, workspaceRoot };
      const id = yield* random
        .uuidV4()
        .pipe(Effect.mapError((cause) => new NamedProjectCreateError({ workspaceRoot, cause })));
      // The copy is complete and marked here, so a rejected creation leaves it for the retry.
      const project = yield* registerProject({
        id,
        name: input.name,
        workspaceRoot,
        removeFolder: Effect.void,
      });
      return {
        projectId: project.id,
        workspaceRoot,
        ...(commitError === undefined ? {} : { commitError }),
      };
    });

  return ManagedProjectFolders.of({
    scratchRoot,
    ensureScratchProject,
    isScratchProject,
    folderForThread,
    namedProjectsRoot,
    createNamedProject,
    relocateScratchFolder,
  });
});

export const layer = Layer.effect(ManagedProjectFolders, make);
