/** @vitest-environment jsdom */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MountedComponentsPanel } from "../MountedComponentsPanel";

describe("MountedComponentsPanel", () => {
  it("renders the empty state when no bundle has loaded", () => {
    render(<MountedComponentsPanel bundle={null} bundleError={null} />);
    expect(screen.getByText(/waiting for bundle/i)).toBeDefined();
  });

  it("renders the error card when bundleError is set", () => {
    render(
      <MountedComponentsPanel bundle={null} bundleError="rolldown broke" />,
    );
    expect(screen.getByText(/rolldown broke/)).toBeDefined();
  });

  it("renders the bundle's PlaygroundEntry when present", () => {
    const PlaygroundEntry = () => <div>mounted</div>;
    const ChatPlayground = () => <div>chat</div>;
    render(
      <MountedComponentsPanel
        bundle={{ PlaygroundEntry, ChatPlayground }}
        bundleError={null}
      />,
    );
    expect(screen.getByText("mounted")).toBeDefined();
  });
});
