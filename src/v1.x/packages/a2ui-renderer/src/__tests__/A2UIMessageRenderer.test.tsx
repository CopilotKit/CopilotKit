import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useState } from "react";
import { v0_8 } from "@a2ui/lit";

describe("A2UIMessageRenderer rendering integration", () => {
  it("should render A2UI surface content via React renderer", async () => {
    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });

    const content = {
      operations: [
        { beginRendering: { surfaceId: "test-surface", root: "root", styles: {} } },
        {
          surfaceUpdate: {
            surfaceId: "test-surface",
            components: [{ id: "root", text: { literalString: "Hello World" } }],
          },
        },
      ],
    };

    const RenderComponent = renderer.render as React.FC<any>;
    const TestWrapper = () => <RenderComponent content={content} agent={null} />;

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    // The React renderer should render a .a2ui-surface element
    const surfaceElement = container!.querySelector("[data-surface-id='test-surface']");
    expect(surfaceElement).not.toBeNull();
  });

  it("should update surface when operations change", async () => {
    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });
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

    // Initial render should have the surface
    const surfaceElement = container!.querySelector("[data-surface-id='test']");
    expect(surfaceElement).not.toBeNull();

    // Update with new data
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

    // Surface should still be present after update
    const updatedSurface = container!.querySelector("[data-surface-id='test']");
    expect(updatedSurface).not.toBeNull();
  });

  it("should return null when no operations are provided", async () => {
    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });
    const RenderComponent = renderer.render as React.FC<any>;

    const TestWrapper = () => <RenderComponent content={{ operations: [] }} agent={null} />;

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    // No surface elements should be rendered
    expect(container!.querySelector("[data-surface-id]")).toBeNull();
  });
});

describe("A2UIMessageRenderer React behavior", () => {
  it("should process operations and create surfaces via message processor", () => {
    const processor = v0_8.Data.createSignalA2uiMessageProcessor();
    const surfaceId = "test-surface";

    const messages: v0_8.Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId, root: "root", styles: {} } },
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: "root",
              direction: "column",
              children: ["text1"],
            } as v0_8.Types.ComponentInstance,
            {
              id: "text1",
              text: { literalString: "Test content" },
            } as v0_8.Types.ComponentInstance,
          ],
        },
      },
    ];

    processor.processMessages(messages);

    const surfaces = processor.getSurfaces();
    expect(surfaces.size).toBe(1);
    expect(surfaces.has(surfaceId)).toBe(true);

    const surface = surfaces.get(surfaceId);
    expect(surface?.componentTree).toBeDefined();
  });

  it("should handle multiple surfaces", () => {
    const processor = v0_8.Data.createSignalA2uiMessageProcessor();

    const messages: v0_8.Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId: "surface-1", root: "root1", styles: {} } },
      { beginRendering: { surfaceId: "surface-2", root: "root2", styles: {} } },
      {
        surfaceUpdate: {
          surfaceId: "surface-1",
          components: [{ id: "root1", text: { literalString: "Surface 1" } } as v0_8.Types.ComponentInstance],
        },
      },
      {
        surfaceUpdate: {
          surfaceId: "surface-2",
          components: [{ id: "root2", text: { literalString: "Surface 2" } } as v0_8.Types.ComponentInstance],
        },
      },
    ];

    processor.processMessages(messages);

    const surfaces = processor.getSurfaces();
    expect(surfaces.size).toBe(2);
    expect(surfaces.has("surface-1")).toBe(true);
    expect(surfaces.has("surface-2")).toBe(true);
  });

  it("should clear surfaces when clearSurfaces is called", () => {
    const processor = v0_8.Data.createSignalA2uiMessageProcessor();
    const surfaceId = "test-surface";

    const messages: v0_8.Types.ServerToClientMessage[] = [
      { beginRendering: { surfaceId, root: "root", styles: {} } },
      {
        surfaceUpdate: {
          surfaceId,
          components: [{ id: "root", text: { literalString: "Test" } } as v0_8.Types.ComponentInstance],
        },
      },
    ];

    processor.processMessages(messages);
    expect(processor.getSurfaces().size).toBe(1);

    processor.clearSurfaces();
    expect(processor.getSurfaces().size).toBe(0);
  });

  it("should render multiple surfaces independently", async () => {
    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });
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

    const TestWrapper = () => <RenderComponent content={content} agent={null} />;

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    // Both surfaces should be rendered independently
    const surface1 = container!.querySelector("[data-surface-id='s1']");
    const surface2 = container!.querySelector("[data-surface-id='s2']");
    expect(surface1).not.toBeNull();
    expect(surface2).not.toBeNull();
  });
});
