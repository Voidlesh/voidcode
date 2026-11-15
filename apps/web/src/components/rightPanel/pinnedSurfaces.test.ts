import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PINNED_SURFACES,
  isSurfacePinned,
  pinnedSurfaceActions,
  sanitizePinnedSurfaces,
  surfaceKeyForKind,
  surfaceKeyForLabel,
  toggleSurfacePinned,
} from "./pinnedSurfaces";

describe("pinnedSurfaces", () => {
  it("defaults to browser and terminal and toggles membership in order", () => {
    expect(DEFAULT_PINNED_SURFACES).toEqual(["browser", "terminal"]);
    expect(isSurfacePinned(DEFAULT_PINNED_SURFACES, "files")).toBe(false);

    const withFiles = toggleSurfacePinned(DEFAULT_PINNED_SURFACES, "files");
    expect(withFiles).toEqual(["browser", "terminal", "files"]);

    const withoutBrowser = toggleSurfacePinned(withFiles, "browser");
    expect(withoutBrowser).toEqual(["terminal", "files"]);
    expect(DEFAULT_PINNED_SURFACES).toEqual(["browser", "terminal"]);
  });

  it("drops invalid stored entries", () => {
    expect(sanitizePinnedSurfaces(["files", "", 3, null])).toEqual(["files"]);
  });

  it("maps labels and surface kinds to the same key", () => {
    expect(surfaceKeyForLabel("Linked pull requests")).toBe(surfaceKeyForKind("pull-requests"));
    expect(surfaceKeyForLabel("Pull request")).toBe(surfaceKeyForKind("pull-request"));
    expect(surfaceKeyForLabel("Browser")).toBe(surfaceKeyForKind("preview"));
    expect(surfaceKeyForLabel("Files")).toBe(surfaceKeyForKind("file"));
    expect(surfaceKeyForLabel("Terminal")).toBe(surfaceKeyForKind("terminal"));
  });

  it("keeps only pinned actions", () => {
    const actions = [{ label: "Browser" }, { label: "Diff" }];
    expect(pinnedSurfaceActions(actions, ["browser"])).toEqual([{ label: "Browser" }]);
  });
});
