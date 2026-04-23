import { describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import { renderAggregator } from "../aggregator-template";
import type { ComponentWithHooks } from "../../types";

const sample: ComponentWithHooks[] = [
  {
    filePath: "/tmp/test/user/src/MyPage.tsx",
    componentName: "MyPage",
    exportName: "MyPage",
    loc: { line: 1, column: 0, endLine: 10, endColumn: 1 },
    hooks: [],
  },
  {
    filePath: "/tmp/test/user/src/side/Sidebar.tsx",
    componentName: "Sidebar",
    exportName: "default",
    loc: { line: 1, column: 0, endLine: 5, endColumn: 1 },
    hooks: [],
  },
  {
    // Component with no export name — skipped with a warning comment.
    filePath: "/tmp/test/user/src/internal/Helper.tsx",
    componentName: "Helper",
    exportName: null,
    loc: { line: 1, column: 0, endLine: 3, endColumn: 1 },
    hooks: [],
  },
];

describe("renderAggregator", () => {
  it("emits one import per exported component and a MountCard per component", () => {
    const code = renderAggregator(sample, {
      outDir: "/tmp/test/out",
      errorBoundaryModule: "./error-boundary",
    });
    expect(code).toContain('import { MyPage } from');
    expect(code).toContain('import Sidebar from');
    expect(code).toContain('import { MountCard } from "./error-boundary"');
    expect(code).toContain('<MountCard componentName="MyPage"');
    expect(code).toContain('<MountCard componentName="Sidebar"');
    // Helper has no exportName — rendered as a skipped card (no import).
    expect(code).toContain("/* skipped: Helper");
  });

  it("uses relative forward-slash paths from outDir to each component", () => {
    const code = renderAggregator(sample, {
      outDir: "/tmp/test/out",
      errorBoundaryModule: "./error-boundary",
    });
    expect(code).toContain("../user/src/MyPage");
    expect(code).toContain("../user/src/side/Sidebar");
    // No backslashes in the emitted source.
    expect(code).not.toMatch(/\\/);
  });

  it("produces parseable TSX", () => {
    const code = renderAggregator(sample, {
      outDir: "/tmp/test/out",
      errorBoundaryModule: "./error-boundary",
    });
    const res = parseSync("aggregator.tsx", code, { lang: "tsx", sourceType: "module" });
    expect(res.errors).toEqual([]);
  });
});
