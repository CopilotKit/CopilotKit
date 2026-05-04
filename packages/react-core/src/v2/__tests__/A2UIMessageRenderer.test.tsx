import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useState } from "react";
import type { Theme } from "@copilotkit/a2ui-renderer";

vi.mock("../providers", () => ({
  useCopilotKit: vi.fn(() => ({
    copilotkit: {
      properties: {},
      setProperties: vi.fn(),
      runAgent: vi.fn().mockResolvedValue(undefined),
    },
  })),
}));

describe("A2UIMessageRenderer rendering integration", () => {
  it("should render A2UI surface content via React renderer", async () => {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });

    const content = {
      operations: [
        {
          beginRendering: {
            surfaceId: "test-surface",
            root: "root",
            styles: {},
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "test-surface",
            components: [
              { id: "root", text: { literalString: "Hello World" } },
            ],
          },
        },
      ],
    };

    const RenderComponent = renderer.render as React.FC<any>;
    const TestWrapper = () => (
      <RenderComponent content={content} agent={null} />
    );

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    const surfaceElement = container!.querySelector(
      "[data-surface-id='test-surface']",
    );
    expect(surfaceElement).not.toBeNull();
  });

  it("should update surface when operations change", async () => {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });
    const RenderComponent = renderer.render as React.FC<any>;

    let setContent: (content: any) => void;
    const TestWrapper = () => {
      const [content, _setContent] = useState({
        operations: [
          { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
          {
            surfaceUpdate: {
              surfaceId: "test",
              components: [{ id: "root", text: { literalString: "Initial" } }],
            },
          },
        ],
      });
      setContent = _setContent;
      return <RenderComponent content={content} agent={null} />;
    };

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    const surfaceElement = container!.querySelector("[data-surface-id='test']");
    expect(surfaceElement).not.toBeNull();

    await act(async () => {
      setContent({
        operations: [
          { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
          {
            surfaceUpdate: {
              surfaceId: "test",
              components: [{ id: "root", text: { literalString: "Updated" } }],
            },
          },
        ],
      });
    });

    const updatedSurface = container!.querySelector("[data-surface-id='test']");
    expect(updatedSurface).not.toBeNull();
  });

  it("should return null when no operations are provided", async () => {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });
    const RenderComponent = renderer.render as React.FC<any>;

    const TestWrapper = () => (
      <RenderComponent content={{ operations: [] }} agent={null} />
    );

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    expect(container!.querySelector("[data-surface-id]")).toBeNull();
  });

  it("should render multiple surfaces independently", async () => {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({
      theme: {} as Theme,
    });
    const RenderComponent = renderer.render as React.FC<any>;

    const content = {
      operations: [
        { beginRendering: { surfaceId: "s1", root: "r1", styles: {} } },
        { beginRendering: { surfaceId: "s2", root: "r2", styles: {} } },
        {
          surfaceUpdate: {
            surfaceId: "s1",
            components: [{ id: "r1", text: { literalString: "Surface 1" } }],
          },
        },
        {
          surfaceUpdate: {
            surfaceId: "s2",
            components: [{ id: "r2", text: { literalString: "Surface 2" } }],
          },
        },
      ],
    };

    const TestWrapper = () => (
      <RenderComponent content={content} agent={null} />
    );

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    const surface1 = container!.querySelector("[data-surface-id='s1']");
    const surface2 = container!.querySelector("[data-surface-id='s2']");
    expect(surface1).not.toBeNull();
    expect(surface2).not.toBeNull();
  });
});
