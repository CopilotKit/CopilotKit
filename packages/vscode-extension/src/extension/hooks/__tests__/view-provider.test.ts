import { describe, it, expect } from "vitest";
import { buildTreeData, findLeaf, statusKeyForSite } from "../tree-model";
import type { HookCallSite } from "../hook-scanner";

const sample: HookCallSite[] = [
  {
    filePath: "/ws/a.tsx",
    hook: "useCopilotAction",
    name: "addTodo",
    loc: { line: 10, column: 0, endLine: 10, endColumn: 0 },
    category: "render",
  },
  {
    filePath: "/ws/a.tsx",
    hook: "useCopilotAction",
    name: "removeTodo",
    loc: { line: 20, column: 0, endLine: 20, endColumn: 0 },
    category: "render",
  },
  {
    filePath: "/ws/b.tsx",
    hook: "useCopilotReadable",
    name: null,
    loc: { line: 5, column: 0, endLine: 5, endColumn: 0 },
    category: "data",
  },
];

describe("buildTreeData", () => {
  it("groups sites by category and then by hook type", () => {
    const tree = buildTreeData(sample);
    const renderGroup = tree.find((g) => g.label === "Render hooks")!;
    expect(renderGroup.children.map((c) => c.label)).toContain(
      "useCopilotAction  (2)",
    );
    const dataGroup = tree.find((g) => g.label === "Data hooks")!;
    expect(dataGroup.children.map((c) => c.label)).toContain(
      "useCopilotReadable  (1)",
    );
  });

  it("hook nodes have sorted leaves with name or file:line", () => {
    const tree = buildTreeData(sample);
    const actionNode = tree
      .find((g) => g.label === "Render hooks")!
      .children.find((c) => c.label.startsWith("useCopilotAction"))!;
    expect(actionNode.children.map((c) => c.label)).toEqual([
      "addTodo",
      "removeTodo",
    ]);
  });

  it("includes empty groups for known hooks not present", () => {
    const tree = buildTreeData(sample);
    const renderGroup = tree.find((g) => g.label === "Render hooks")!;
    const emptyHumanITL = renderGroup.children.find((c) =>
      c.label.startsWith("useHumanInTheLoop"),
    );
    expect(emptyHumanITL?.label).toMatch(/\(0\)$/);
    expect(emptyHumanITL?.children).toEqual([]);
  });
});

describe("findLeaf", () => {
  it("locates the leaf matching a given site", () => {
    const tree = buildTreeData(sample);
    const leaf = findLeaf(tree, sample[0]);
    expect(leaf?.label).toBe("addTodo");
  });

  it("returns null for a site not in the tree", () => {
    const tree = buildTreeData(sample);
    const stranger: HookCallSite = {
      filePath: "/ws/nowhere.tsx",
      hook: "useCopilotAction",
      name: "ghost",
      loc: { line: 1, column: 0, endLine: 1, endColumn: 0 },
      category: "render",
    };
    expect(findLeaf(tree, stranger)).toBeNull();
  });
});

describe("statusKeyForSite", () => {
  it("uses line fallback for nameless hooks", () => {
    expect(statusKeyForSite(sample[2]!)).toBe(
      "/ws/b.tsx::useCopilotReadable::line:5",
    );
  });

  it("uses name when present", () => {
    expect(statusKeyForSite(sample[0]!)).toBe(
      "/ws/a.tsx::useCopilotAction::addTodo",
    );
  });
});
