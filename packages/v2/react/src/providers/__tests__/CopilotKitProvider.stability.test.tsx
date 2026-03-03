import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type { ReactToolCallRenderer } from "../../types";
import {
  CopilotKitProvider,
  useCopilotKit,
  type CopilotKitContextValue,
} from "../CopilotKitProvider";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { useFrontendTool } from "../../hooks/use-frontend-tool";

// Mock console methods to suppress expected warnings
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe("CopilotKitProvider stability", () => {
  describe("instance stability", () => {
    it("returns the same copilotkit instance after re-render with new renderToolCalls array", () => {
      const instances: CopilotKitCoreReact[] = [];

      function Collector({ children }: { children?: React.ReactNode }) {
        const { copilotkit } = useCopilotKit();
        instances.push(copilotkit);
        return <>{children}</>;
      }

      const renderToolCalls1: ReactToolCallRenderer<any>[] = [
        {
          name: "tool1",
          args: z.object({ a: z.string() }),
          render: () => <div>Tool 1</div>,
        },
      ];

      const renderToolCalls2: ReactToolCallRenderer<any>[] = [
        {
          name: "tool1",
          args: z.object({ a: z.string() }),
          render: () => <div>Tool 1 updated</div>,
        },
      ];

      const { rerender } = render(
        <CopilotKitProvider renderToolCalls={renderToolCalls1}>
          <Collector />
        </CopilotKitProvider>,
      );

      rerender(
        <CopilotKitProvider renderToolCalls={renderToolCalls2}>
          <Collector />
        </CopilotKitProvider>,
      );

      expect(instances.length).toBeGreaterThanOrEqual(2);
      const first = instances[0];
      for (const instance of instances) {
        expect(instance).toBe(first);
      }
    });

    it("returns the same copilotkit instance after re-render with new frontendTools array", () => {
      const instances: CopilotKitCoreReact[] = [];

      function Collector() {
        const { copilotkit } = useCopilotKit();
        instances.push(copilotkit);
        return null;
      }

      const tools1: ReactFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];
      const tools2: ReactFrontendTool[] = [
        { name: "toolB", description: "Tool B", handler: vi.fn() },
      ];

      const { rerender } = render(
        <CopilotKitProvider frontendTools={tools1}>
          <Collector />
        </CopilotKitProvider>,
      );

      rerender(
        <CopilotKitProvider frontendTools={tools2}>
          <Collector />
        </CopilotKitProvider>,
      );

      expect(instances.length).toBeGreaterThanOrEqual(2);
      const first = instances[0];
      for (const instance of instances) {
        expect(instance).toBe(first);
      }
    });
  });

  describe("context value stability", () => {
    it("does not change context value reference when only tools change", () => {
      const contextValues: CopilotKitContextValue[] = [];

      function Collector() {
        const context = useCopilotKit();
        contextValues.push(context);
        return null;
      }

      const tools1: ReactFrontendTool[] = [
        { name: "toolA", description: "Tool A" },
      ];
      const tools2: ReactFrontendTool[] = [
        { name: "toolB", description: "Tool B" },
      ];

      const { rerender } = render(
        <CopilotKitProvider frontendTools={tools1}>
          <Collector />
        </CopilotKitProvider>,
      );

      const initialContext = contextValues[contextValues.length - 1];

      rerender(
        <CopilotKitProvider frontendTools={tools2}>
          <Collector />
        </CopilotKitProvider>,
      );

      const afterRerender = contextValues[contextValues.length - 1];

      expect(afterRerender?.copilotkit).toBe(initialContext?.copilotkit);
      expect(afterRerender?.executingToolCallIds).toBe(
        initialContext?.executingToolCallIds,
      );
    });
  });

  describe("setter calls on prop changes", () => {
    it("calls setTools when frontendTools change instead of recreating instance", () => {
      const setToolsSpy = vi.fn();
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const originalSetTools = copilotkit.setTools.bind(copilotkit);
          copilotkit.setTools = (tools) => {
            setToolsSpy(tools);
            return originalSetTools(tools);
          };
          spyAttached = true;
        }
        return null;
      }

      const tools1: ReactFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];
      const tools2: ReactFrontendTool[] = [
        { name: "toolB", description: "Tool B", handler: vi.fn() },
      ];

      const { rerender } = render(
        <CopilotKitProvider frontendTools={tools1}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      setToolsSpy.mockClear();

      rerender(
        <CopilotKitProvider frontendTools={tools2}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      expect(setToolsSpy).toHaveBeenCalled();
    });

    it("calls setRenderToolCalls when renderToolCalls change", () => {
      const setRenderToolCallsSpy = vi.fn();
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const original = copilotkit.setRenderToolCalls.bind(copilotkit);
          copilotkit.setRenderToolCalls = (renderToolCalls) => {
            setRenderToolCallsSpy(renderToolCalls);
            return original(renderToolCalls);
          };
          spyAttached = true;
        }
        return null;
      }

      const rtc1: ReactToolCallRenderer<any>[] = [
        {
          name: "render1",
          args: z.object({ x: z.string() }),
          render: () => <div>R1</div>,
        },
      ];
      const rtc2: ReactToolCallRenderer<any>[] = [
        {
          name: "render2",
          args: z.object({ y: z.string() }),
          render: () => <div>R2</div>,
        },
      ];

      const { rerender } = render(
        <CopilotKitProvider renderToolCalls={rtc1}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      setRenderToolCallsSpy.mockClear();

      rerender(
        <CopilotKitProvider renderToolCalls={rtc2}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      expect(setRenderToolCallsSpy).toHaveBeenCalled();
    });
  });

  describe("no unnecessary re-renders from stable props", () => {
    it("does not re-render children when provider re-renders with same stable props", () => {
      let childRenderCount = 0;

      function Child() {
        childRenderCount++;
        useCopilotKit();
        return <div>child</div>;
      }

      const stableTools: ReactFrontendTool[] = [
        { name: "tool1", description: "Tool 1" },
      ];

      const { rerender } = render(
        <CopilotKitProvider frontendTools={stableTools}>
          <Child />
        </CopilotKitProvider>,
      );

      const initialCount = childRenderCount;

      rerender(
        <CopilotKitProvider frontendTools={stableTools}>
          <Child />
        </CopilotKitProvider>,
      );

      expect(childRenderCount - initialCount).toBeLessThanOrEqual(1);
    });
  });

  describe("setter effects skip initial mount (didMountRef guard)", () => {
    it("does not call setTools on initial mount (constructor handles it)", () => {
      const setToolsCalls: unknown[][] = [];
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const originalSetTools = copilotkit.setTools.bind(copilotkit);
          copilotkit.setTools = (tools) => {
            setToolsCalls.push([tools]);
            return originalSetTools(tools);
          };
          spyAttached = true;
        }
        return null;
      }

      const tools: ReactFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];

      render(
        <CopilotKitProvider frontendTools={tools}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      // setTools should NOT have been called on initial mount
      // because the constructor already sets the initial tools
      // and the didMountRef guard skips the first effect invocation.
      expect(setToolsCalls).toHaveLength(0);
    });

    it("does not call setRenderToolCalls on initial mount", () => {
      const calls: unknown[][] = [];
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const original = copilotkit.setRenderToolCalls.bind(copilotkit);
          copilotkit.setRenderToolCalls = (renderToolCalls) => {
            calls.push([renderToolCalls]);
            return original(renderToolCalls);
          };
          spyAttached = true;
        }
        return null;
      }

      const rtc: ReactToolCallRenderer<any>[] = [
        {
          name: "render1",
          args: z.object({ x: z.string() }),
          render: () => <div>R1</div>,
        },
      ];

      render(
        <CopilotKitProvider renderToolCalls={rtc}>
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      // Provider setter effects are skipped on mount;
      // only the constructor sets the initial render tool calls.
      expect(calls).toHaveLength(0);
    });
  });

  describe("dynamic tool preservation on mount", () => {
    it("preserves dynamically registered tools from child hooks after provider mounts", () => {
      let capturedInstance: CopilotKitCoreReact | null = null;

      function DynamicToolChild() {
        const { copilotkit } = useCopilotKit();
        capturedInstance = copilotkit;

        // Register a tool dynamically via the hook
        useFrontendTool({
          name: "dynamicTool",
          description: "A dynamically registered tool",
          handler: async () => "result",
        });

        return null;
      }

      // Provider has its own tool via props
      const providerTools: ReactFrontendTool[] = [
        { name: "providerTool", description: "From provider props", handler: vi.fn() },
      ];

      render(
        <CopilotKitProvider frontendTools={providerTools}>
          <DynamicToolChild />
        </CopilotKitProvider>,
      );

      // Both the provider tool (from constructor) and the dynamic tool
      // (from useFrontendTool hook) should exist on the instance.
      // If the provider's setter effects ran on mount and called setTools(),
      // the dynamic tool would be wiped out.
      expect(capturedInstance).not.toBeNull();
      const dynamicTool = capturedInstance!.getTool({ toolName: "dynamicTool" });
      const providerTool = capturedInstance!.getTool({ toolName: "providerTool" });
      expect(dynamicTool).toBeDefined();
      expect(providerTool).toBeDefined();
    });

    it("preserves dynamically registered render tool calls from child hooks after provider mounts", () => {
      let capturedInstance: CopilotKitCoreReact | null = null;

      function DynamicRenderChild() {
        const { copilotkit } = useCopilotKit();
        capturedInstance = copilotkit;

        useFrontendTool({
          name: "renderableTool",
          description: "Has a render function",
          parameters: z.object({ msg: z.string() }),
          handler: async () => "ok",
          render: () => <div>Rendered!</div>,
        });

        return null;
      }

      const providerRtc: ReactToolCallRenderer<any>[] = [
        {
          name: "providerRenderer",
          args: z.object({ x: z.string() }),
          render: () => <div>Provider Render</div>,
        },
      ];

      render(
        <CopilotKitProvider renderToolCalls={providerRtc}>
          <DynamicRenderChild />
        </CopilotKitProvider>,
      );

      expect(capturedInstance).not.toBeNull();
      const renderToolCalls = capturedInstance!.renderToolCalls;

      // Both the provider-level renderer and the hook-registered renderer
      // should exist. If setter effects ran on mount, only the provider
      // renderer would remain.
      const providerRenderer = renderToolCalls.find(
        (r) => r.name === "providerRenderer",
      );
      const hookRenderer = renderToolCalls.find(
        (r) => r.name === "renderableTool",
      );
      expect(providerRenderer).toBeDefined();
      expect(hookRenderer).toBeDefined();
    });
  });

  describe("React.StrictMode", () => {
    it("returns the same copilotkit instance in StrictMode", () => {
      const instances: CopilotKitCoreReact[] = [];

      function Collector() {
        const { copilotkit } = useCopilotKit();
        instances.push(copilotkit);
        return null;
      }

      render(
        <React.StrictMode>
          <CopilotKitProvider>
            <Collector />
          </CopilotKitProvider>
        </React.StrictMode>,
      );

      // StrictMode double-renders in dev, so we expect multiple captures
      expect(instances.length).toBeGreaterThanOrEqual(2);
      const first = instances[0];
      for (const instance of instances) {
        expect(instance).toBe(first);
      }
    });

    it("calls setTools at most once during StrictMode mount cycle", () => {
      const setToolsCalls: unknown[][] = [];
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const originalSetTools = copilotkit.setTools.bind(copilotkit);
          copilotkit.setTools = (tools) => {
            setToolsCalls.push([tools]);
            return originalSetTools(tools);
          };
          spyAttached = true;
        }
        return null;
      }

      const tools: ReactFrontendTool[] = [
        { name: "toolA", description: "Tool A", handler: vi.fn() },
      ];

      render(
        <React.StrictMode>
          <CopilotKitProvider frontendTools={tools}>
            <SpyAttacher />
          </CopilotKitProvider>
        </React.StrictMode>,
      );

      // StrictMode fires effects twice (mount → cleanup → remount).
      // The didMountRef guard skips the initial mount. After cleanup,
      // didMountRef.current stays true (refs persist), so the remount
      // call fires setTools once. This is expected and harmless — it
      // sets the same tools the constructor already established.
      // The critical invariant (dynamic tools not overwritten) is
      // verified by the separate "preserves dynamically registered
      // tools through StrictMode remount cycle" test.
      expect(setToolsCalls.length).toBeLessThanOrEqual(1);
    });

    it("preserves dynamically registered tools through StrictMode remount cycle", () => {
      let capturedInstance: CopilotKitCoreReact | null = null;

      function DynamicToolChild() {
        const { copilotkit } = useCopilotKit();
        capturedInstance = copilotkit;

        useFrontendTool({
          name: "strictModeTool",
          description: "Survives StrictMode remount",
          handler: async () => "ok",
        });

        return null;
      }

      render(
        <React.StrictMode>
          <CopilotKitProvider>
            <DynamicToolChild />
          </CopilotKitProvider>
        </React.StrictMode>,
      );

      expect(capturedInstance).not.toBeNull();
      const tool = capturedInstance!.getTool({ toolName: "strictModeTool" });
      expect(tool).toBeDefined();
    });

    it("context value is stable through StrictMode remount", () => {
      const contextValues: CopilotKitContextValue[] = [];

      function Collector() {
        const context = useCopilotKit();
        contextValues.push(context);
        return null;
      }

      render(
        <React.StrictMode>
          <CopilotKitProvider>
            <Collector />
          </CopilotKitProvider>
        </React.StrictMode>,
      );

      expect(contextValues.length).toBeGreaterThanOrEqual(2);
      const first = contextValues[0]!;
      for (const ctx of contextValues) {
        expect(ctx.copilotkit).toBe(first.copilotkit);
        expect(ctx.executingToolCallIds).toBe(first.executingToolCallIds);
      }
    });
  });

  describe("runtimeUrl deduplication", () => {
    it("always calls setRuntimeUrl with the same URL on re-render (AgentRegistry deduplicates)", () => {
      const setRuntimeUrlCalls: unknown[] = [];
      let spyAttached = false;

      function SpyAttacher() {
        const { copilotkit } = useCopilotKit();
        if (!spyAttached) {
          const original = copilotkit.setRuntimeUrl.bind(copilotkit);
          copilotkit.setRuntimeUrl = (...args: [string | undefined]) => {
            setRuntimeUrlCalls.push(args[0]);
            return original(...args);
          };
          spyAttached = true;
        }
        return null;
      }

      const { rerender } = render(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      // Re-render with the SAME runtimeUrl
      rerender(
        <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
          <SpyAttacher />
        </CopilotKitProvider>,
      );

      // The config effect may re-fire if other deps (mergedHeaders, etc.)
      // change reference on rerender. The actual deduplication of /info
      // fetches happens inside AgentRegistry.setRuntimeUrl(), which has
      // a guard: `if (this._runtimeUrl === normalizedRuntimeUrl) return`.
      // Here we verify every call receives the same URL.
      expect(setRuntimeUrlCalls.length).toBeGreaterThanOrEqual(1);
      for (const url of setRuntimeUrlCalls) {
        expect(url).toBe("http://localhost:3000/api");
      }
    });
  });
});
