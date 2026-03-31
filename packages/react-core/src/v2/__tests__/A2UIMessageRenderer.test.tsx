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
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "test-surface",
            catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "test-surface",
            components: [
              {
                id: "root",
                component: "Text",
                text: "Hello World",
                variant: "body",
              },
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
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "test",
              catalogId:
                "https://a2ui.org/specification/v0_9/basic_catalog.json",
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "test",
              components: [
                {
                  id: "root",
                  component: "Text",
                  text: "Initial",
                  variant: "body",
                },
              ],
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
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "test",
              catalogId:
                "https://a2ui.org/specification/v0_9/basic_catalog.json",
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "test",
              components: [
                {
                  id: "root",
                  component: "Text",
                  text: "Updated",
                  variant: "body",
                },
              ],
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
      <RenderComponent content={{ a2ui_operations: [] }} agent={null} />
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
      a2ui_operations: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "s1",
            catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "s2",
            catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s1",
            components: [
              {
                id: "root",
                component: "Text",
                text: "Surface 1",
                variant: "body",
              },
            ],
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s2",
            components: [
              {
                id: "root",
                component: "Text",
                text: "Surface 2",
                variant: "body",
              },
            ],
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
