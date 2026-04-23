import { render, waitFor } from "@testing-library/react";
import { renderHook } from "../../../test-helpers/render-hook";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// Mock console methods
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

describe("CopilotKitProvider", () => {
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

  describe("Basic functionality", () => {
    it("provides context to children", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      expect(result.current).toBeDefined();
      expect(result.current.copilotkit).toBeDefined();
    });

    it("throws error when used outside provider", () => {
      // Temporarily restore console.error for this test
      consoleErrorSpy.mockRestore();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        renderHook(() => useCopilotKit());
      }).toThrow();

      errorSpy.mockRestore();
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
  });

  describe("frontendTools prop", () => {
    it("registers frontend tools with CopilotKitCore", () => {
      const mockHandler = vi.fn();
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "testTool",
          description: "A test tool",
          parameters: z.object({
            input: z.string(),
          }),
          handler: mockHandler,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const tool = result.current.copilotkit.getTool({ toolName: "testTool" });
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("testTool");
      expect(tool?.handler).toBe(mockHandler);
    });

    it("includes render components from frontend tools", () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "renderTool",
          description: "A tool with render",
          parameters: z.object({
            input: z.string(),
          }),
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const renderTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "renderTool",
      );
      expect(renderTool).toBeDefined();
      expect(renderTool?.render).toBe(TestComponent);
    });

    it("warns when frontendTools prop changes", async () => {
      const initialTools: ReactFrontendTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
        },
      ];

      const { rerender } = render(
        <CopilotKitProvider frontendTools={initialTools}>
          <div>Test</div>
        </CopilotKitProvider>,
      );

      const newTools: ReactFrontendTool[] = [
        {
          name: "tool2",
          description: "Tool 2",
        },
      ];

      rerender(
        <CopilotKitProvider frontendTools={newTools}>
          <div>Test</div>
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("frontendTools must be a stable array"),
        );
      });
    });
  });

  describe("humanInTheLoop prop", () => {
    it("processes humanInTheLoop tools and creates handlers", () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const humanInTheLoopTools: ReactHumanInTheLoop[] = [
        {
          name: "approvalTool",
          description: "Requires human approval",
          parameters: z.object({
            question: z.string(),
          }),
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider humanInTheLoop={humanInTheLoopTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      // Check that the tool is registered
      const tool = result.current.copilotkit.getTool({
        toolName: "approvalTool",
      });
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("approvalTool");
      expect(tool?.handler).toBeDefined();

      // Check that render component is registered
      const approvalTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "approvalTool",
      );
      expect(approvalTool).toBeDefined();
      expect(approvalTool?.render).toBe(TestComponent);
    });

    it("creates placeholder handlers for humanInTheLoop tools", async () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const humanInTheLoopTools: ReactHumanInTheLoop[] = [
        {
          name: "interactiveTool",
          description: "Interactive tool",
          parameters: z.object({
            data: z.string(),
          }),
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider humanInTheLoop={humanInTheLoopTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const handler = result.current.copilotkit.getTool({
        toolName: "interactiveTool",
      })?.handler;
      expect(handler).toBeDefined();

      // Call the handler and check for warning
      const handlerPromise = handler!({ data: "test" }, {} as any);

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "Human-in-the-loop tool 'interactiveTool' called",
          ),
        );
      });

      const result2 = await handlerPromise;
      expect(result2).toBeUndefined();
    });

    it("warns when humanInTheLoop prop changes", async () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const initialTools: ReactHumanInTheLoop[] = [
        {
          name: "tool1",
          description: "Tool 1",
          render: TestComponent,
        },
      ];

      const { rerender } = render(
        <CopilotKitProvider humanInTheLoop={initialTools}>
          <div>Test</div>
        </CopilotKitProvider>,
      );

      const newTools: ReactHumanInTheLoop[] = [
        {
          name: "tool2",
          description: "Tool 2",
          render: TestComponent,
        },
      ];

      rerender(
        <CopilotKitProvider humanInTheLoop={newTools}>
          <div>Test</div>
        </CopilotKitProvider>,
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("humanInTheLoop must be a stable array"),
        );
      });
    });
  });

  describe("Combined tools functionality", () => {
    it("registers both frontendTools and humanInTheLoop tools", () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "frontendTool",
          description: "Frontend tool",
          handler: vi.fn(),
        },
      ];
      const humanInTheLoopTools: ReactHumanInTheLoop[] = [
        {
          name: "humanTool",
          description: "Human tool",
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            frontendTools={frontendTools}
            humanInTheLoop={humanInTheLoopTools}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(
        result.current.copilotkit.getTool({ toolName: "frontendTool" }),
      ).toBeDefined();
      expect(
        result.current.copilotkit.getTool({ toolName: "humanTool" }),
      ).toBeDefined();
    });

    it("should handle agentId in frontend tools", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const frontendTools: ReactFrontendTool[] = [
        {
          name: "globalTool",
          description: "Global tool",
          handler: handler1,
        },
        {
          name: "agentSpecificTool",
          description: "Agent specific tool",
          handler: handler2,
          agentId: "specificAgent",
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const globalTool = result.current.copilotkit.getTool({
        toolName: "globalTool",
      });
      expect(globalTool).toBeDefined();
      expect(globalTool?.agentId).toBeUndefined();
      const agentTool = result.current.copilotkit.getTool({
        toolName: "agentSpecificTool",
        agentId: "specificAgent",
      });
      expect(agentTool).toBeDefined();
      expect(agentTool?.agentId).toBe("specificAgent");
    });

    it("combines render components from all sources", () => {
      const TestComponent1: React.FC<any> = () => <div>Test1</div>;
      const TestComponent2: React.FC<any> = () => <div>Test2</div>;
      const TestComponent3: React.FC<any> = () => <div>Test3</div>;

      const frontendTools: ReactFrontendTool[] = [
        {
          name: "frontendRenderTool",
          description: "Frontend render tool",
          parameters: z.object({ a: z.string() }),
          render: TestComponent1,
        },
      ];

      const humanInTheLoopTools: ReactHumanInTheLoop[] = [
        {
          name: "humanRenderTool",
          description: "Human render tool",
          parameters: z.object({ b: z.string() }),
          render: TestComponent2,
        },
      ];

      const renderToolCalls = [
        {
          name: "directRenderTool",
          args: z.object({ c: z.string() }),
          render: TestComponent3,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            frontendTools={frontendTools}
            humanInTheLoop={humanInTheLoopTools}
            renderToolCalls={renderToolCalls}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      const frontendRenderTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "frontendRenderTool",
      );
      const humanRenderTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "humanRenderTool",
      );
      const directRenderTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "directRenderTool",
      );

      expect(frontendRenderTool).toBeDefined();
      expect(humanRenderTool).toBeDefined();
      expect(directRenderTool).toBeDefined();

      expect(frontendRenderTool?.render).toBe(TestComponent1);
      expect(humanRenderTool?.render).toBe(TestComponent2);
      expect(directRenderTool?.render).toBe(TestComponent3);
    });
  });

  describe("renderToolCalls management", () => {
    it("includes render tools from frontendTools prop", async () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "tool1",
          description: "Tool 1",
          parameters: z.object({ a: z.string() }),
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const tool1 = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "tool1",
      );
      expect(tool1).toBeDefined();
      expect(tool1?.render).toBe(TestComponent);
    });
  });

  describe("a2ui prop", () => {
    const originalFetch = global.fetch;
    const originalWindow = (globalThis as { window?: unknown }).window;

    beforeEach(() => {
      // Leave the jsdom window intact (React 17's renderer touches
      // window.HTMLIFrameElement and window.addEventListener during commit)
      // and only shadow location so CopilotKitProvider's localhost
      // auto-open-inspector heuristic skips.
      if (originalWindow && typeof originalWindow === "object") {
        Object.defineProperty(originalWindow, "location", {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    });

    it("does not register an a2ui-surface renderer by default", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      const a2uiRenderer =
        result.current.copilotkit.renderActivityMessages.find(
          (r) => r.activityType === "a2ui-surface",
        );
      expect(a2uiRenderer).toBeUndefined();
    });

    it("does not register an a2ui-surface renderer when a2ui.theme is provided but runtime has not signaled a2uiEnabled", () => {
      const customTheme = { components: {}, elements: {}, markdown: {} } as any;

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider a2ui={{ theme: customTheme }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const a2uiRenderer =
        result.current.copilotkit.renderActivityMessages.find(
          (r) => r.activityType === "a2ui-surface",
        );
      expect(a2uiRenderer).toBeUndefined();
    });

    it("registers an a2ui-surface renderer when runtime reports a2uiEnabled: true", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          a2uiEnabled: true,
        }),
      });

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
            {children}
          </CopilotKitProvider>
        ),
      });

      await vi.waitFor(() => {
        const a2uiRenderer =
          result.current.copilotkit.renderActivityMessages.find(
            (r) => r.activityType === "a2ui-surface",
          );
        expect(a2uiRenderer).toBeDefined();
      });
    });

    it("does not register an a2ui-surface renderer when runtime reports a2uiEnabled: false", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          a2uiEnabled: false,
        }),
      });

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
            {children}
          </CopilotKitProvider>
        ),
      });

      // Let the connection settle
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const a2uiRenderer =
        result.current.copilotkit.renderActivityMessages.find(
          (r) => r.activityType === "a2ui-surface",
        );
      expect(a2uiRenderer).toBeUndefined();
    });

    it("user-provided renderActivityMessages with activityType a2ui-surface takes precedence over built-in", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          a2uiEnabled: true,
        }),
      });

      const userRenderer = {
        activityType: "a2ui-surface",
        content: {} as any,
        render: () => null,
      };

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider
            runtimeUrl="http://localhost:3000/api"
            renderActivityMessages={[userRenderer]}
          >
            {children}
          </CopilotKitProvider>
        ),
      });

      await vi.waitFor(() => {
        const renderers =
          result.current.copilotkit.renderActivityMessages.filter(
            (r) => r.activityType === "a2ui-surface",
          );
        // Both present; user-provided comes first (index 0)
        expect(renderers.length).toBeGreaterThanOrEqual(1);
        expect(renderers[0].render).toBe(userRenderer.render);
      });
    });
  });

  describe("useSingleEndpoint → runtimeTransport mapping", () => {
    it("maps useSingleEndpoint=true to 'single' transport", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider useSingleEndpoint={true}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.copilotkit.runtimeTransport).toBe("single");
    });

    it("maps useSingleEndpoint=false to 'rest' transport", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider useSingleEndpoint={false}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current.copilotkit.runtimeTransport).toBe("rest");
    });

    it("maps omitted useSingleEndpoint to 'auto' transport", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      expect(result.current.copilotkit.runtimeTransport).toBe("auto");
    });

    it("updates transport when useSingleEndpoint prop changes", () => {
      let capturedCopilotkit: ReturnType<typeof useCopilotKit>["copilotkit"];

      function Collector({ children }: { children?: React.ReactNode }) {
        const { copilotkit } = useCopilotKit();
        capturedCopilotkit = copilotkit;
        return <>{children}</>;
      }

      const { rerender } = render(
        <CopilotKitProvider useSingleEndpoint={false}>
          <Collector />
        </CopilotKitProvider>,
      );

      expect(capturedCopilotkit!.runtimeTransport).toBe("rest");

      rerender(
        <CopilotKitProvider useSingleEndpoint={true}>
          <Collector />
        </CopilotKitProvider>,
      );

      expect(capturedCopilotkit!.runtimeTransport).toBe("single");

      rerender(
        <CopilotKitProvider>
          <Collector />
        </CopilotKitProvider>,
      );

      expect(capturedCopilotkit!.runtimeTransport).toBe("auto");
    });
  });

  describe("Edge cases", () => {
    it("handles empty arrays for tools", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={[]} humanInTheLoop={[]}>
            {children}
          </CopilotKitProvider>
        ),
      });

      // No built-in tools when openGenerativeUI is not configured
      expect(result.current.copilotkit.tools).toHaveLength(0);
      expect(result.current.copilotkit.renderToolCalls).toHaveLength(0);
    });

    it("handles tools without render components", () => {
      const frontendTools: ReactFrontendTool[] = [
        {
          name: "noRenderTool",
          description: "Tool without render",
          handler: vi.fn(),
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider frontendTools={frontendTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(
        result.current.copilotkit.getTool({ toolName: "noRenderTool" }),
      ).toBeDefined();
      const noRenderTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "noRenderTool",
      );
      expect(noRenderTool).toBeUndefined();
    });

    it("handles humanInTheLoop tools with followUp flag", () => {
      const TestComponent: React.FC<any> = () => <div>Test</div>;
      const humanInTheLoopTools: ReactHumanInTheLoop[] = [
        {
          name: "followUpTool",
          description: "Tool with followUp",
          parameters: z.object({ a: z.string() }),
          followUp: false,
          render: TestComponent,
        },
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider humanInTheLoop={humanInTheLoopTools}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(
        result.current.copilotkit.getTool({ toolName: "followUpTool" })
          ?.followUp,
      ).toBe(false);
    });
  });
});
