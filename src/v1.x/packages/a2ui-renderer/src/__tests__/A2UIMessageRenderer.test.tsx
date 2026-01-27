import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useState } from "react";
import { v0_8 } from "@a2ui/lit";

// Track which processor factory is called
let signalProcessorCallCount = 0;
let standardProcessorCallCount = 0;

const originalCreateSignal = v0_8.Data.createSignalA2uiMessageProcessor;
const OriginalStandard = v0_8.Data.A2uiMessageProcessor;

describe("A2UIMessageRenderer uses correct processor type", () => {
  beforeEach(() => {
    signalProcessorCallCount = 0;
    standardProcessorCallCount = 0;

    // Wrap the signal processor factory to track calls
    v0_8.Data.createSignalA2uiMessageProcessor = function () {
      signalProcessorCallCount++;
      return originalCreateSignal();
    };

    // Wrap the standard processor constructor to track calls
    (v0_8.Data as any).A2uiMessageProcessor = class extends OriginalStandard {
      constructor() {
        super();
        standardProcessorCallCount++;
      }
    };
  });

  afterEach(() => {
    // Restore originals
    v0_8.Data.createSignalA2uiMessageProcessor = originalCreateSignal;
    (v0_8.Data as any).A2uiMessageProcessor = OriginalStandard;
  });

  it("REGRESSION: A2UIMessageRenderer must use signal-based processor (not standard) for reactive data updates", async () => {
    // Dynamically import to get fresh module with our spied constructors
    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");

    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });

    // Create a test wrapper component that renders the A2UI message
    const TestWrapper = () => {
      const content = {
        operations: [
          { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
          {
            surfaceUpdate: {
              surfaceId: "test",
              components: [{ id: "root", text: { literalString: "Hello" } }],
            },
          },
        ],
      };

      // Call the render function from the renderer
      const RenderComponent = renderer.render as React.FC<any>;
      return <RenderComponent content={content} agent={null} />;
    };

    // Render the component
    await act(async () => {
      render(<TestWrapper />);
    });

    // THE KEY ASSERTION: Signal processor should be used, NOT standard processor
    // This test will FAIL if A2UIMessageRenderer uses `new A2uiMessageProcessor()`
    // and PASS if it uses `createSignalA2uiMessageProcessor()`
    expect(signalProcessorCallCount).toBeGreaterThan(0);
    expect(standardProcessorCallCount).toBe(0);
  });
});

// Test the processor behavior directly to expose the bug
describe("A2UI Processor Data Updates", () => {
  describe("Signal-based vs Standard processor", () => {
    it("both processors can process messages and create surfaces", () => {
      const signalProcessor = v0_8.Data.createSignalA2uiMessageProcessor();
      const standardProcessor = new v0_8.Data.A2uiMessageProcessor();
      const surfaceId = "test-surface";

      const messages: v0_8.Types.ServerToClientMessage[] = [
        { beginRendering: { surfaceId, root: "root", styles: {} } },
        {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: "root",
                text: { literalString: "Hello" },
              } as v0_8.Types.ComponentInstance,
            ],
          },
        },
      ];

      signalProcessor.processMessages(messages);
      standardProcessor.processMessages(messages);

      expect(signalProcessor.getSurfaces().has(surfaceId)).toBe(true);
      expect(standardProcessor.getSurfaces().has(surfaceId)).toBe(true);
    });

    it("signal processor is the correct type for reactive updates", () => {
      // The signal-based processor integrates with Lit's reactive system
      // This is what A2UIViewer uses and what A2UIMessageRenderer SHOULD use
      const signalProcessor = v0_8.Data.createSignalA2uiMessageProcessor();
      const standardProcessor = new v0_8.Data.A2uiMessageProcessor();

      // Verify they have the same API but are different instances
      expect(typeof signalProcessor.processMessages).toBe("function");
      expect(typeof standardProcessor.processMessages).toBe("function");
      expect(signalProcessor).not.toBe(standardProcessor);

      // The key difference: signal processor triggers Lit reactivity
      // Standard processor does not - this is the root cause of the bug
    });
  });

  describe("A2UIMessageRenderer signature-based update detection (has bug)", () => {
    // This simulates the buggy behavior in A2UIMessageRenderer
    // where signature comparison prevents updates when operations are "the same"

    function stringifyOperations(ops: any[]): string | null {
      try {
        return JSON.stringify(ops);
      } catch {
        return null;
      }
    }

    it("should detect when data values change in operations", () => {
      const operations1 = [
        { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
        {
          dataModelUpdate: {
            surfaceId: "test",
            path: "/",
            contents: [{ key: "count", valueNumber: 1 }],
          },
        },
      ];

      const operations2 = [
        { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
        {
          dataModelUpdate: {
            surfaceId: "test",
            path: "/",
            contents: [{ key: "count", valueNumber: 2 }],
          },
        },
      ];

      const sig1 = stringifyOperations(operations1);
      const sig2 = stringifyOperations(operations2);

      // When data values change, signatures SHOULD be different
      expect(sig1).not.toBe(sig2);
    });

    it("BUG: signature comparison causes missed updates when content prop reference changes but operations are identical", () => {
      // This exposes the bug: when React re-renders with the same operations
      // (e.g., from a parent state update), the signature is the same,
      // so the processor doesn't re-process even if the Lit surface
      // needs to re-render with reactive data

      const operations = [
        { beginRendering: { surfaceId: "test", root: "root", styles: {} } },
        {
          surfaceUpdate: {
            surfaceId: "test",
            components: [{ id: "root", type: "text", text: { path: "/message" } }],
          },
        },
        {
          dataModelUpdate: {
            surfaceId: "test",
            path: "/",
            contents: [{ key: "message", valueString: "Hello" }],
          },
        },
      ];

      // Create two different array references with same content
      const contentProp1 = { operations: [...operations] };
      const contentProp2 = { operations: [...operations] };

      // These are different object references
      expect(contentProp1).not.toBe(contentProp2);

      // But their signatures are the same
      const sig1 = stringifyOperations(contentProp1.operations);
      const sig2 = stringifyOperations(contentProp2.operations);
      expect(sig1).toBe(sig2);

      // BUG: A2UIMessageRenderer returns early when signature matches,
      // so even if the surface's underlying data binding should update
      // (due to signal-based reactivity), the processor never gets
      // the chance to process it
    });

    it("BUG: non-reactive processor doesn't trigger Lit re-renders on data changes", () => {
      // This is the core bug: A2UIMessageRenderer uses a non-reactive processor
      // The standard processor doesn't emit signals that Lit can observe
      // So even when data changes, the Lit component doesn't know to re-render

      const standardProcessor = new v0_8.Data.A2uiMessageProcessor();
      const signalProcessor = v0_8.Data.createSignalA2uiMessageProcessor();

      // Verify both processor types exist and have the same API
      expect(typeof standardProcessor.processMessages).toBe("function");
      expect(typeof standardProcessor.getData).toBe("function");
      expect(typeof standardProcessor.getSurfaces).toBe("function");

      expect(typeof signalProcessor.processMessages).toBe("function");
      expect(typeof signalProcessor.getData).toBe("function");
      expect(typeof signalProcessor.getSurfaces).toBe("function");

      // The key difference: signal processor integrates with Lit's reactive system
      // Standard processor does not - this is why A2UIMessageRenderer doesn't update
      // when data changes but A2UIViewer does

      // This test documents the bug - both processors should behave the same
      // for data updates, but only signal processor triggers Lit reactivity
    });
  });
});

describe("A2UIMessageRenderer rendering integration", () => {
  it("should render the themed-a2ui-surface custom element with surface data", async () => {
    // Restore original processors for this test
    v0_8.Data.createSignalA2uiMessageProcessor = originalCreateSignal;
    (v0_8.Data as any).A2uiMessageProcessor = OriginalStandard;

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

    // Wrap in a component to properly invoke hooks
    const RenderComponent = renderer.render as React.FC<any>;
    const TestWrapper = () => <RenderComponent content={content} agent={null} />;

    let container: HTMLElement;
    await act(async () => {
      const result = render(<TestWrapper />);
      container = result.container;
    });

    // Verify the custom element was rendered
    const surfaceElement = container!.querySelector("themed-a2ui-surface");
    expect(surfaceElement).not.toBeNull();
    expect(surfaceElement?.getAttribute("data-surface-id")).toBe("test-surface");

    // Verify the surface element received the processor and surface data
    const element = surfaceElement as any;
    expect(element.processor).toBeDefined();
    expect(element.surface).toBeDefined();
    expect(element.surfaceId).toBe("test-surface");
  });

  it("should update surface when operations change", async () => {
    v0_8.Data.createSignalA2uiMessageProcessor = originalCreateSignal;
    (v0_8.Data as any).A2uiMessageProcessor = OriginalStandard;

    const { createA2UIMessageRenderer } = await import("../A2UIMessageRenderer.js");
    const renderer = createA2UIMessageRenderer({ theme: {} as v0_8.Types.Theme });
    const RenderComponent = renderer.render as React.FC<any>;

    // Component that allows us to update content
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
          {
            dataModelUpdate: {
              surfaceId: "test",
              path: "/",
              contents: [{ key: "count", valueNumber: 1 }],
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

    // Get initial surface element
    const surfaceElement = container!.querySelector("themed-a2ui-surface") as any;
    expect(surfaceElement).not.toBeNull();
    const initialProcessor = surfaceElement.processor;

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
          {
            dataModelUpdate: {
              surfaceId: "test",
              path: "/",
              contents: [{ key: "count", valueNumber: 2 }],
            },
          },
        ],
      });
    });

    // Processor should have processed the new messages
    const updatedSurfaceElement = container!.querySelector("themed-a2ui-surface") as any;
    expect(updatedSurfaceElement.processor).toBeDefined();
    expect(updatedSurfaceElement.surface).toBeDefined();

    // The processor should be the same instance (reused)
    expect(updatedSurfaceElement.processor).toBe(initialProcessor);
  });
});

describe("A2UIMessageRenderer React behavior", () => {
  it("should process operations and create surfaces", () => {
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
});
