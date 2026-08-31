import { afterEach, describe, it, expect, vi } from "vitest";
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
const BASIC_CATALOG = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/** Mirrors PAINT_FALLBACK_MS in the renderer. */
const PAINT_FALLBACK_MS = 8000;

/**
 * A generative-UI card that does not paint is silent by default: the operations
 * are accepted, the loader drops, and the only trace is an empty placeholder
 * above the reply. These cover the two reports that break that silence.
 */
describe("A2UIMessageRenderer — reporting a card that renders nothing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function loadRenderer() {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    return createA2UIMessageRenderer({ theme: {} as Theme })
      .render as React.FC<any>;
  }

  it("reports a surface that received operations and never painted", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "never-paints",
                catalogId: BASIC_CATALOG,
              },
            },
          ],
        }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    const report = messages.find((message) =>
      message.includes('A2UI surface "never-paints" received operations'),
    );
    expect(report).toBeDefined();
    expect(report).toContain("never painted");
    expect(report).toContain("no updateComponents operation arrived");
    expect(report).toContain("Operations received: createSurface");
  });

  it("names the missing data model when bound components drew empty", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: { surfaceId: "bound", catalogId: BASIC_CATALOG },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "bound",
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: { path: "/headline" },
                    variant: "body",
                  },
                ],
              },
            },
          ],
        }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const report = warn.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.includes('A2UI surface "bound"'));
    expect(report).toBeDefined();
    expect(report).toContain("no updateDataModel carried a non-empty value");
  });

  it("stays silent about paint when the surface does paint", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: { surfaceId: "healthy", catalogId: BASIC_CATALOG },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "healthy",
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
        }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes("never painted"))).toEqual([]);
    expect(messages.filter((m) => m.includes("no surface by that id"))).toEqual(
      [],
    );
  });

  // Both renderers start walking a surface at the component with id "root" and
  // show an animated placeholder for an id they cannot find. A payload that
  // names its entry point anything else is complete, accepted, and permanently
  // a grey box: the surface exists, nothing throws, the component type is never
  // reached, and `surfaceHasRenderableContent` says yes, so `onReady` fires and
  // the never-painted report above is deliberately suppressed. (OSS-1057)
  it("reports a payload whose components never name a root", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: {
                surfaceId: "rootless",
                catalogId: BASIC_CATALOG,
              },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "rootless",
                components: [
                  {
                    id: "card",
                    component: "Text",
                    text: { path: "/headline" },
                    variant: "body",
                  },
                ],
              },
            },
            {
              version: "v0.9",
              updateDataModel: {
                surfaceId: "rootless",
                value: { headline: "Hello World" },
              },
            },
          ],
        }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    const report = messages.find((message) =>
      message.includes('A2UI surface "rootless" has no "root" component'),
    );
    expect(report).toBeDefined();
    expect(report).toContain('the components it received are named "card"');
    expect(report).toContain('rename the entry-point component to "root"');
    expect(report).toContain(
      "Operations received: createSurface, updateComponents, updateDataModel",
    );

    // The payload is renderable on paper, so the never-painted report stays out
    // of the way rather than reporting the same card twice.
    expect(messages.filter((m) => m.includes("never painted"))).toEqual([]);
  });

  // A root that WAS sent and still is not in the model is a different fault with
  // a different fix, so the report says which of the two it is.
  it("distinguishes a root that was sent from one that was never named", async () => {
    const { warnAboutUnresolvedRoot } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const operations = [
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "dropped",
          components: [{ id: "root", component: "Text", text: "Hello World" }],
        },
      },
    ];

    warnAboutUnresolvedRoot("dropped", operations, {
      componentsModel: { get: () => undefined },
    });

    const report = warn.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.includes('A2UI surface "dropped"'));
    expect(report).toBeDefined();
    expect(report).toContain('a component with id "root" WAS sent');
    expect(report).toContain("did not reach the surface's model");
    expect(report).not.toContain("rename the entry-point component");
  });

  it("stays silent about the root when the surface resolves one", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: { surfaceId: "rooted", catalogId: BASIC_CATALOG },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "rooted",
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
        }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('no "root" component'))).toEqual(
      [],
    );
  });

  // Components stream in, so the snapshot that carries the root can arrive after
  // one that does not. The deadline runs from the LAST operations to land, so the
  // early snapshot must not be reported.
  it("stays silent when the root arrives in a later snapshot", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();

    const createSurface = {
      version: "v0.9",
      createSurface: { surfaceId: "late-root", catalogId: BASIC_CATALOG },
    };
    const withoutRoot = {
      version: "v0.9",
      updateComponents: {
        surfaceId: "late-root",
        components: [{ id: "card", component: "Text", text: "Hello World" }],
      },
    };
    const withRoot = {
      version: "v0.9",
      updateComponents: {
        surfaceId: "late-root",
        components: [
          { id: "card", component: "Text", text: "Hello World" },
          { id: "root", component: "Text", text: "Hello World" },
        ],
      },
    };

    const { rerender } = render(
      <RenderComponent
        content={{ a2ui_operations: [createSurface, withoutRoot] }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS / 2);
    });

    rerender(
      <RenderComponent
        content={{ a2ui_operations: [createSurface, withRoot] }}
        agent={null}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAINT_FALLBACK_MS);
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes('no "root" component'))).toEqual(
      [],
    );
  });

  it("reports operations addressed to a surface that was never created", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              createSurface: { surfaceId: "created", catalogId: BASIC_CATALOG },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "addressed",
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
        }}
        agent={null}
      />,
    );

    // Deferred one macrotask so a mid-stream snapshot is not reported.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const report = warn.mock.calls
      .map((call) => String(call[0]))
      .find((message) => message.includes('addressed to surface "addressed"'));
    expect(report).toBeDefined();
    expect(report).toContain("no surface by that id exists");
    expect(report).toContain('A createSurface for "addressed"');
  });

  // Operations stream in, so a snapshot can reach the processor before the
  // createSurface that gives them somewhere to go. Reporting that snapshot would
  // make the warning fire on healthy runs, which is worse than staying quiet.
  it("stays silent when the createSurface arrives in a later snapshot", async () => {
    const RenderComponent = await loadRenderer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const components = [
      {
        id: "root",
        component: "Text",
        text: "Hello World",
        variant: "body",
      },
    ];

    const control: { publish?: (content: any) => void } = {};
    const Wrapper = () => {
      const [content, setContent] = useState<any>({
        a2ui_operations: [
          {
            version: "v0.9",
            updateComponents: { surfaceId: "late", components },
          },
        ],
      });
      control.publish = setContent;
      return <RenderComponent content={content} agent={null} />;
    };

    render(<Wrapper />);

    // The createSurface lands before the deferred check gets to run.
    await act(async () => {
      control.publish!({
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: { surfaceId: "late", catalogId: BASIC_CATALOG },
          },
          {
            version: "v0.9",
            updateComponents: { surfaceId: "late", components },
          },
        ],
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes("no surface by that id"))).toEqual(
      [],
    );
  });
});

/**
 * `MessageProcessor` creates a surface under the id nested in the operation's
 * payload, so grouping has to resolve the same id or the operations are filed
 * against a surface that never exists — a card that paints nothing. The
 * web-components path in `@copilotkit/a2ui-renderer` resolves it by the same
 * rule. (OSS-1048)
 */
describe("A2UIMessageRenderer — resolving which surface an operation addresses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("groups by the nested surface id, not a top-level one", async () => {
    const { createA2UIMessageRenderer } =
      await import("../a2ui/A2UIMessageRenderer.js");
    const RenderComponent = createA2UIMessageRenderer({ theme: {} as Theme })
      .render as React.FC<any>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <RenderComponent
        content={{
          a2ui_operations: [
            {
              version: "v0.9",
              surfaceId: "top-level",
              createSurface: {
                surfaceId: "nested",
                catalogId: BASIC_CATALOG,
              },
            },
            {
              version: "v0.9",
              surfaceId: "top-level",
              updateComponents: {
                surfaceId: "nested",
                components: [
                  {
                    id: "root",
                    component: "Text",
                    text: "Nested wins",
                    variant: "body",
                  },
                ],
              },
            },
          ],
        }}
        agent={null}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector("[data-surface-id='nested']"),
      ).not.toBeNull();
    });
    expect(container.querySelector("[data-surface-id='top-level']")).toBeNull();

    // Grouping under "top-level" would file the operations against a surface
    // createSurface never made, which is the silence the report names.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((m) => m.includes("no surface by that id"))).toEqual(
      [],
    );
  });
});
