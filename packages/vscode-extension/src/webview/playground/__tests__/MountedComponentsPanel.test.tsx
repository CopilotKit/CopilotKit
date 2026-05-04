/** @vitest-environment jsdom */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MountedComponentsPanel } from "../MountedComponentsPanel";
import type { PlaygroundScanResult } from "../../../extension/playground/types";

const emptyScan: PlaygroundScanResult = {
  providers: [],
  componentsWithHooks: [],
  hookSites: [],
  warnings: [],
};

const scanWith = (
  components: PlaygroundScanResult["componentsWithHooks"],
): PlaygroundScanResult => ({ ...emptyScan, componentsWithHooks: components });

describe("MountedComponentsPanel", () => {
  it("renders the empty state when no bundle has loaded", () => {
    render(
      <MountedComponentsPanel
        bundle={null}
        bundleError={null}
        scan={emptyScan}
        mountErrors={[]}
        collapsed={false}
        onOpenSource={vi.fn()}
      />,
    );
    expect(screen.getByText(/waiting for bundle/i)).toBeDefined();
  });

  it("renders the error card when bundleError is set", () => {
    render(
      <MountedComponentsPanel
        bundle={null}
        bundleError="rolldown broke"
        scan={emptyScan}
        mountErrors={[]}
        collapsed={false}
        onOpenSource={vi.fn()}
      />,
    );
    expect(screen.getByText(/rolldown broke/)).toBeDefined();
  });

  it("lists scanned components with file path opens", () => {
    const PlaygroundEntry = () => <div>mounted</div>;
    const ChatPlayground = () => <div>chat</div>;
    const onOpenSource = vi.fn();
    render(
      <MountedComponentsPanel
        bundle={{ PlaygroundEntry, ChatPlayground }}
        bundleError={null}
        scan={scanWith([
          {
            componentName: "Data",
            filePath: "/src/Data.tsx",
            exportName: "Data",
            loc: { line: 1, column: 0, endLine: 1, endColumn: 0 },
            hooks: [],
          },
        ])}
        mountErrors={[]}
        collapsed={false}
        onOpenSource={onOpenSource}
      />,
    );
    const button = screen.getByText("Data") as HTMLButtonElement;
    expect(button).toBeDefined();
    button.click();
    expect(onOpenSource).toHaveBeenCalledWith("/src/Data.tsx", 1);
  });

  it("flags components that failed to mount and surfaces the error message", () => {
    const PlaygroundEntry = () => <div>mounted</div>;
    const ChatPlayground = () => <div>chat</div>;
    render(
      <MountedComponentsPanel
        bundle={{ PlaygroundEntry, ChatPlayground }}
        bundleError={null}
        scan={scanWith([
          {
            componentName: "Data",
            filePath: "/src/Data.tsx",
            exportName: "Data",
            loc: { line: 1, column: 0, endLine: 1, endColumn: 0 },
            hooks: [],
          },
        ])}
        mountErrors={[
          {
            componentName: "Data",
            filePath: "/src/Data.tsx",
            error: { message: "boom" },
          },
        ]}
        collapsed={false}
        onOpenSource={vi.fn()}
      />,
    );
    expect(screen.getByText("boom")).toBeDefined();
    expect(
      document.querySelector(".playground-mounted-row-error"),
    ).not.toBeNull();
  });
});
