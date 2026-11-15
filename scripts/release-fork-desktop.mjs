import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const FORK_REPOSITORY = "Voidlesh/voidcode";
const UPSTREAM_URL = "https://github.com/pingdotgg/t3code.git";
const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const releaseDir = NodePath.join(repoRoot, "release");
const skipBuild = process.argv.includes("--skip-build");
const checkUpstream = process.argv.includes("--check-upstream");
const syncUpstream = process.argv.includes("--sync-upstream");

function run(command, args, options = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    stdio: "inherit",
    cwd: repoRoot,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function capture(command, args) {
  return NodeChildProcess.spawnSync(command, args, { encoding: "utf8", cwd: repoRoot });
}

function latestUpstreamStableTag() {
  const listed = capture("git", ["ls-remote", "--tags", "--refs", UPSTREAM_URL]);
  if (listed.status !== 0) throw new Error(`Could not list tags of ${UPSTREAM_URL}.`);
  const parts = (tag) => tag.slice(1).split(".").map(Number);
  const tags = listed.stdout
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter((tag) => tag && /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const [pa, pb] = [parts(a), parts(b)];
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
  if (tags.length === 0) throw new Error(`No stable release tag found on ${UPSTREAM_URL}.`);
  return tags[tags.length - 1];
}

// The original's tag goes under refs/upstream so it cannot clash with this fork's own v* tags.
if (checkUpstream || syncUpstream) {
  const tag = latestUpstreamStableTag();
  const ref = `refs/upstream/${tag}`;
  run("git", ["fetch", "--no-tags", UPSTREAM_URL, `+refs/tags/${tag}:${ref}`]);
  const merged = capture("git", ["merge-base", "--is-ancestor", ref, "HEAD"]).status === 0;
  if (merged) {
    console.log(`The original ${tag} is already part of this fork.`);
  } else if (checkUpstream) {
    console.log(`The original has a newer release: ${tag}. Run with --sync-upstream to merge it.`);
  } else {
    if (capture("git", ["status", "--porcelain"]).stdout.trim()) {
      throw new Error("Commit or stash your changes before --sync-upstream.");
    }
    if (capture("git", ["merge", "--no-edit", ref]).status !== 0) {
      throw new Error(
        `Merging ${tag} has conflicts. Resolve them (git status), commit, then rerun without --sync-upstream.`,
      );
    }
    console.log(`Merged the original ${tag}. Run \`vp i\` if dependencies changed.`);
  }
  if (checkUpstream) process.exit(0);
}

const { version } = JSON.parse(
  NodeFS.readFileSync(NodePath.join(repoRoot, "apps", "desktop", "package.json"), "utf8"),
);
const tag = `v${version}`;

if (capture("gh", ["auth", "status"]).status !== 0) {
  throw new Error("gh is not logged in. Run `gh auth login` once, then retry.");
}
if (capture("gh", ["release", "view", tag, "--repo", FORK_REPOSITORY]).status === 0) {
  throw new Error(
    `Release ${tag} already exists on ${FORK_REPOSITORY}. Bump the version in apps/desktop/package.json first.`,
  );
}

if (!skipBuild) {
  run(
    process.execPath,
    ["scripts/build-desktop-artifact.ts", "--platform", "win", "--target", "nsis", "--arch", "x64"],
    {
      env: { ...process.env, T3CODE_DESKTOP_UPDATE_REPOSITORY: FORK_REPOSITORY },
    },
  );
}

const assets = NodeFS.readdirSync(releaseDir)
  .filter((name) => /\.(exe|blockmap)$/.test(name) || /^latest.*\.yml$/.test(name))
  .map((name) => NodePath.join(releaseDir, name));

if (!assets.some((asset) => asset.endsWith("latest.yml"))) {
  throw new Error(`No latest.yml in ${releaseDir}; the updater cannot find this release.`);
}

run("gh", [
  "release",
  "create",
  tag,
  ...assets,
  "--repo",
  FORK_REPOSITORY,
  "--title",
  `VoidCode ${tag}`,
  "--notes",
  `Desktop build ${version} for Windows, with ${FORK_REPOSITORY} as its update feed.`,
]);

console.log(`Published ${tag} to ${FORK_REPOSITORY} with ${assets.length} assets.`);
