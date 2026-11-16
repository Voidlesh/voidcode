import { describe, expect, it } from "vite-plus/test";

import { pendingProjectProposal } from "./projectProposal";

const proposal = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  item: {
    id,
    type: "dynamic_tool",
    status: "completed",
    toolName: "mcp__t3-code__propose_project",
    output: JSON.stringify({ projectProposal: { name }, message: "Asked." }),
    ...overrides,
  },
});

describe("pendingProjectProposal", () => {
  it("offers the latest finished proposal and never an older one once it is answered", () => {
    const items = [proposal("a", "Old Idea"), proposal("b", "Pinball Stats")];
    expect(pendingProjectProposal(items, new Set())).toEqual({
      itemId: "b",
      name: "Pinball Stats",
    });
    expect(pendingProjectProposal(items, new Set(["b"]))).toBeNull();
  });

  it.each([
    ["a running call", { status: "running" }],
    ["a refused proposal", { output: { isError: true, projectProposal: { name: "X" } } }],
    ["another tool", { toolName: "mcp__t3-code__send_to_user" }],
  ])("ignores %s", (_label, overrides) => {
    expect(
      pendingProjectProposal([proposal("a", "Pinball Stats", overrides)], new Set()),
    ).toBeNull();
  });
});
