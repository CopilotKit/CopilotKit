/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScannerView } from "../ScannerView";
import type { PlaygroundScanResult } from "../../../extension/playground/types";

const result: PlaygroundScanResult = {
  providers: [
    {
      filePath: "/workspace/src/app.tsx",
      loc: { line: 5, column: 4, endLine: 7, endColumn: 2 },
      props: { runtimeUrl: "/api/copilotkit", publicApiKey: "pk_test" },
      importedName: "CopilotKit" as const,
      importSource: "@copilotkit/react-core" as const,
    },
  ],
  ancestorChain: [
    {
      tagName: "AuthProvider",
      props: {},
      loc: { line: 3, column: 0, endLine: 10, endColumn: 0 },
      filePath: "/workspace/src/app.tsx",
    },
  ],
  componentsWithHooks: [
    {
      filePath: "/workspace/src/my-page.tsx",
      exportName: "MyPage",
      componentName: "MyPage",
      loc: { line: 3, column: 0, endLine: 6, endColumn: 1 },
      hooks: [
        {
          filePath: "/workspace/src/my-page.tsx",
          hook: "useCopilotAction",
          name: "addTodo",
          loc: { line: 4, column: 2, endLine: 4, endColumn: 20 },
          category: "render",
        },
      ],
    },
  ],
  hookSites: [],
  warnings: [],
};

describe("ScannerView", () => {
  it("renders provider, ancestor chain, and components", () => {
    render(<ScannerView result={result} onOpenSource={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText(/app\.tsx/)).toBeDefined();
    expect(screen.getByText("AuthProvider")).toBeDefined();
    expect(screen.getByText("MyPage")).toBeDefined();
    expect(screen.getByText("useCopilotAction")).toBeDefined();
  });

  it('shows "no provider" empty state when no providers found', () => {
    render(
      <ScannerView
        result={{ providers: [], componentsWithHooks: [], hookSites: [], warnings: [] }}
        onOpenSource={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText(/no .*CopilotKit.* provider/i)).toBeDefined();
  });

  it("invokes onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <ScannerView
        result={{ providers: [], componentsWithHooks: [], hookSites: [], warnings: [] }}
        onOpenSource={() => {}}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenSource with file path when a location is clicked", () => {
    const onOpenSource = vi.fn();
    render(<ScannerView result={result} onOpenSource={onOpenSource} onRefresh={() => {}} />);
    fireEvent.click(screen.getByText(/app\.tsx/));
    expect(onOpenSource).toHaveBeenCalledWith("/workspace/src/app.tsx", 5);
  });
});
