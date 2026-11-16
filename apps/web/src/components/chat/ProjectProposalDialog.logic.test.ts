import { describe, expect, it } from "vite-plus/test";

import { pendingProjectProposal, rememberAnsweredProposal } from "./ProjectProposalDialog.logic";

const proposalRow = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
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
  it("offers the latest finished proposal and skips it once answered", () => {
    const rows = [proposalRow("a", "Old Idea"), { item: { id: "u", type: "user_message" } }];
    expect(pendingProjectProposal(rows, [])).toEqual({ itemId: "a", name: "Old Idea" });
    expect(pendingProjectProposal([...rows, proposalRow("b", "Pinball Stats")], ["a"])).toEqual({
      itemId: "b",
      name: "Pinball Stats",
    });
    // An answered latest proposal does not bring back an older one the user never saw.
    expect(pendingProjectProposal([...rows, proposalRow("b", "Pinball Stats")], ["b"])).toBeNull();
  });

  it.each([
    ["a call that is still running", { status: "running" }],
    ["a failed call", { status: "failed" }],
    ["a refused proposal", { output: { isError: true, projectProposal: { name: "X" } } }],
    ["another tool", { toolName: "mcp__t3-code__send_to_user" }],
  ])("ignores %s", (_label, overrides) => {
    expect(pendingProjectProposal([proposalRow("a", "Pinball Stats", overrides)], [])).toBeNull();
  });
});

describe("rememberAnsweredProposal", () => {
  it("keeps the most recent answers only", () => {
    const many = Array.from({ length: 60 }, (_, index) => `item-${index}`);
    const next = rememberAnsweredProposal(many, "item-3");
    expect(next).toHaveLength(50);
    expect(next.at(-1)).toBe("item-3");
    expect(next.filter((id) => id === "item-3")).toHaveLength(1);
  });
});
