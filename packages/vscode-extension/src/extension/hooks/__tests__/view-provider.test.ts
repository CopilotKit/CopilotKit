import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => {
  class EventEmitter<T> {
    readonly event = (_listener: (e: T) => void) => ({ dispose: () => {} });
    fire(_e?: T): void {}
  }
  class TreeItem {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    description?: string;
    tooltip?: string;
    command?: unknown;
    iconPath?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(public readonly id: string, public readonly color?: unknown) {}
  }
  class ThemeColor {
    constructor(public readonly id: string) {}
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    TreeItemCollapsibleState,
  };
});

import { buildTreeData } from "../view-provider";
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
