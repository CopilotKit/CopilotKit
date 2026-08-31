import { describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
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

    const { container } = render(<TestWrapper />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-surface-id='test-surface']"),
      ).not.toBeNull();
    });
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

    const { container } = render(<TestWrapper />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-surface-id='test']"),
      ).not.toBeNull();
    });

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

    await waitFor(() => {
      expect(
        container.querySelector("[data-surface-id='test']"),
      ).not.toBeNull();
    });
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

    const { container } = render(<TestWrapper />);

    expect(container.querySelector("[data-surface-id]")).toBeNull();
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

    const { container } = render(<TestWrapper />);

    await waitFor(() => {
      expect(container.querySelector("[data-surface-id='s1']")).not.toBeNull();
      expect(container.querySelector("[data-surface-id='s2']")).not.toBeNull();
    });
  });
});

describe("runA2UIAction onAction interceptor", () => {
  const makeCopilotkit = () => ({
    properties: {} as Record<string, unknown>,
    setProperties: vi.fn(),
    runAgent: vi.fn().mockResolvedValue(undefined),
  });

  const message = {
    userAction: {
      name: "navigate",
      surfaceId: "s1",
      sourceComponentId: "btn",
      context: { to: "/settings" },
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  };

  it("does NOT run the agent when onAction returns null", async () => {
    const { runA2UIAction } = await import("../a2ui/A2UIMessageRenderer.js");
    const copilotkit = makeCopilotkit();
    const onAction = vi.fn().mockReturnValue(null);

    await runA2UIAction({ message, agent: "my-agent", copilotkit, onAction });

    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction.mock.calls[0][0]).toEqual(message.userAction);
    expect(copilotkit.runAgent).not.toHaveBeenCalled();
    expect(copilotkit.setProperties).not.toHaveBeenCalled();
  });

  it("forwards the modified action when onAction returns one", async () => {
    const { runA2UIAction } = await import("../a2ui/A2UIMessageRenderer.js");
    const copilotkit = makeCopilotkit();
    const modified = { ...message.userAction, name: "navigate_handled" };
    const onAction = vi.fn().mockReturnValue(modified);

    await runA2UIAction({ message, agent: "my-agent", copilotkit, onAction });

    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent: "my-agent" });
    const forwarded = copilotkit.setProperties.mock.calls[0][0];
    expect(forwarded.a2uiAction).toEqual({
      ...message,
      userAction: modified,
    });
  });

  it("forwards the original message unchanged when no onAction is supplied", async () => {
    const { runA2UIAction } = await import("../a2ui/A2UIMessageRenderer.js");
    const copilotkit = makeCopilotkit();

    await runA2UIAction({ message, agent: "my-agent", copilotkit });

    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent: "my-agent" });
    const forwarded = copilotkit.setProperties.mock.calls[0][0];
    expect(forwarded.a2uiAction).toBe(message);
  });

  it("forwards unchanged when onAction returns undefined", async () => {
    const { runA2UIAction } = await import("../a2ui/A2UIMessageRenderer.js");
    const copilotkit = makeCopilotkit();
    const onAction = vi.fn().mockReturnValue(undefined);

    await runA2UIAction({ message, agent: "my-agent", copilotkit, onAction });

    expect(onAction).toHaveBeenCalledOnce();
    expect(copilotkit.runAgent).toHaveBeenCalledWith({ agent: "my-agent" });
    const forwarded = copilotkit.setProperties.mock.calls[0][0];
    expect(forwarded.a2uiAction).toBe(message);
  });
});
