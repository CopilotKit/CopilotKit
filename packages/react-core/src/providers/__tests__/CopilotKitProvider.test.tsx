import { act, render, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import type { ReactFrontendTool } from "../../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../../types/human-in-the-loop";
import {
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTIVITY_TYPE,
} from "@copilotkit/shared";
import { HttpAgent } from "@ag-ui/client";
import { defineWebInspector } from "@copilotkit/web-inspector";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";
import { stubWindowLocation } from "../../test-helpers/stub-window-location";

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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  describe("inspector visibility", () => {
    async function settleInspectorLoad(): Promise<void> {
      await act(async () => {
        await vi.dynamicImportSettled();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
      vi.mocked(defineWebInspector).mockClear();
    });

    it("renders by default on a local development host and passes the provider core before connection", async () => {
      const restoreLocation = stubWindowLocation("http://localhost:3000");
      let providerCore: ReturnType<typeof useCopilotKit>["copilotkit"] | null =
        null;
      const Probe = () => {
        providerCore = useCopilotKit().copilotkit;
        return null;
      };

      try {
        render(
          <CopilotKitProvider>
            <Probe />
          </CopilotKitProvider>,
        );

        await waitFor(() => {
          const inspector = document.querySelector<
            HTMLElement & {
              autoAttachCore?: boolean;
              autoAttachCoreAtConnection?: boolean;
              core?: unknown;
              coreAtConnection?: unknown;
            }
          >("cpk-web-inspector");
          expect(inspector?.core).toBe(providerCore);
          expect(inspector?.autoAttachCore).toBe(false);
          expect(inspector?.coreAtConnection).toBe(providerCore);
          expect(inspector?.autoAttachCoreAtConnection).toBe(false);
        });
      } finally {
        restoreLocation();
      }
    });

    it("does not render or load when explicitly disabled in development", async () => {
      render(
        <CopilotKitProvider enableInspector={false}>child</CopilotKitProvider>,
      );
      await settleInspectorLoad();
      expect(document.querySelector("cpk-web-inspector")).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
    });

    it("never renders or loads in production, even when explicitly enabled", async () => {
      vi.stubEnv("NODE_ENV", "production");
      render(
        <CopilotKitProvider runtimeUrl="/api/copilotkit" enableInspector={true}>
          child
        </CopilotKitProvider>,
      );
      await settleInspectorLoad();
      expect(document.querySelector("cpk-web-inspector")).toBeNull();
      expect(defineWebInspector).not.toHaveBeenCalled();
    });

    it("does not render or load the inspector during SSR", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubGlobal("window", undefined);
      const html = renderToString(
        <CopilotKitProvider enableInspector={true}>child</CopilotKitProvider>,
      );
      await settleInspectorLoad();
      expect(html).not.toContain("cpk-web-inspector");
      expect(defineWebInspector).not.toHaveBeenCalled();
    });

    it("hydrates development markup before mounting the Inspector", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const element = (
        <CopilotKitProvider enableInspector={true}>
          <div>child</div>
        </CopilotKitProvider>
      );

      vi.stubGlobal("window", undefined);
      container.innerHTML = renderToString(element);
      vi.unstubAllGlobals();

      const onRecoverableError = vi.fn();
      const root = hydrateRoot(container, element, { onRecoverableError });

      try {
        await waitFor(() => {
          expect(container.querySelector("cpk-web-inspector")).not.toBeNull();
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  });
  describe("selfManagedAgents license signal", () => {
    const ENTERPRISE_WARNING = "Enterprise Intelligence tier";

    it("warns when selfManagedAgents is provided without a license key", () => {
      const agent = new HttpAgent({ url: "http://localhost:8000" });
      render(
        <CopilotKitProvider selfManagedAgents={{ myAgent: agent }}>
          child
        </CopilotKitProvider>,
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(ENTERPRISE_WARNING),
      );
      // selfManagedAgents satisfies hasLocalAgents, so the separate
      // missing-runtime config warning must NOT fire here.
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Missing required prop"),
      );
    });

    it("does not warn when selfManagedAgents is paired with a license key", () => {
      const agent = new HttpAgent({ url: "http://localhost:8000" });
      render(
        <CopilotKitProvider
          selfManagedAgents={{ myAgent: agent }}
          publicLicenseKey="ck_lic_test"
        >
          child
        </CopilotKitProvider>,
      );
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(ENTERPRISE_WARNING),
      );
    });

    it("does not warn for the free agents__unsafe_dev_only escape hatch", () => {
      const agent = new HttpAgent({ url: "http://localhost:8000" });
      render(
        <CopilotKitProvider agents__unsafe_dev_only={{ myAgent: agent }}>
          child
        </CopilotKitProvider>,
      );
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining(ENTERPRISE_WARNING),
      );
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
      expect(tool?.type).toBe("human-in-the-loop");
      expect(tool?.handler).toBeDefined();

      // Check that render component is registered
      const approvalTool = result.current.copilotkit.renderToolCalls.find(
        (rc) => rc.name === "approvalTool",
      );
      expect(approvalTool).toBeDefined();
      // The registered render is a wrapper that supplies the human-in-the-loop
      // prop contract, so assert that it renders the caller's component rather
      // than comparing identity.
      const Registered = approvalTool!.render;
      const { getByText } = render(
        <Registered
          name="approvalTool"
          toolCallId="tc-1"
          args={{}}
          status={ToolCallStatus.InProgress}
          result={undefined}
        />,
      );
      expect(getByText("Test")).toBeDefined();
    });

    it("keeps a humanInTheLoop tool call waiting instead of resolving it", async () => {
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

      const settled = vi.fn();
      void Promise.resolve(
        handler!({ data: "test" }, {
          toolCall: { id: "tc-1", function: { name: "interactiveTool" } },
        } as any),
      ).then(settled, settled);

      // The handler parks until the render calls `respond`. It must not settle
      // on its own, and it must not warn: waiting is the contract, not a gap.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("no interactive handler is set up"),
      );
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
      expect(directRenderTool?.render).toBe(TestComponent3);
      // A humanInTheLoop render is wrapped to receive `respond`, so check that
      // the wrapper renders the caller's component instead of its identity.
      const HumanRender = humanRenderTool!.render;
      const { getByText } = render(
        <HumanRender
          name="humanRenderTool"
          toolCallId="tc-1"
          args={{}}
          status={ToolCallStatus.InProgress}
          result={undefined}
        />,
      );
      expect(getByText("Test2")).toBeDefined();
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

  describe("generative UI from the runtime", () => {
    const originalFetch = global.fetch;
    let restoreLocation: () => void = () => {};

    beforeEach(() => {
      // Clear window.location so the auto-open-inspector heuristic skips, while
      // keeping the real jsdom window intact for React 18's renderer.
      restoreLocation = stubWindowLocation();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      restoreLocation();
    });

    const mockInfo = (generativeUI?: { enabled: boolean }) => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          ...(generativeUI ? { generativeUI } : {}),
        }),
      });
    };

    const surfaceRenderers = (copilotkit: {
      renderActivityMessages: readonly {
        activityType: string;
        render: unknown;
      }[];
    }) =>
      copilotkit.renderActivityMessages.filter(
        (r) => r.activityType === GENERATIVE_UI_ACTIVITY_TYPE,
      );

    it("does not register a generative UI surface renderer by default", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      expect(surfaceRenderers(result.current.copilotkit)).toEqual([]);
    });

    it("registers a generative UI surface renderer when the runtime reports generativeUI enabled", async () => {
      mockInfo({ enabled: true });

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
            {children}
          </CopilotKitProvider>
        ),
      });

      await vi.waitFor(() => {
        expect(surfaceRenderers(result.current.copilotkit)).toHaveLength(1);
      });
    });

    it("does not register a generative UI surface renderer when the runtime reports it off", async () => {
      mockInfo({ enabled: false });

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider runtimeUrl="http://localhost:3000/api">
            {children}
          </CopilotKitProvider>
        ),
      });

      await vi.waitFor(() => {
        expect(result.current.copilotkit.runtimeConnectionStatus).toBe(
          "connected",
        );
      });
      expect(surfaceRenderers(result.current.copilotkit)).toEqual([]);
    });

    it("puts a user-provided generative UI surface renderer before the built-in one", async () => {
      mockInfo({ enabled: true });

      const userRenderer = {
        activityType: GENERATIVE_UI_ACTIVITY_TYPE,
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
        const renderers = surfaceRenderers(result.current.copilotkit);
        // Both present; user-provided comes first (index 0)
        expect(renderers).toHaveLength(2);
        expect(renderers[0]!.render).toBe(userRenderer.render);
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

  // OSS-1133: naming the agent used to require the v1 `<CopilotKit agent>`
  // wrapper, because the v2 provider carried no agent prop at all.
  describe("agentId", () => {
    it("becomes the default agent for a chat that does not name one", () => {
      const { result } = renderHook(() => useCopilotChatConfiguration(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider agentId="my_agent">
            <CopilotChatConfigurationProvider>
              {children}
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        ),
      });

      expect(result.current?.agentId).toBe("my_agent");
    });

    it("lets a nested chat configuration override it", () => {
      const { result } = renderHook(() => useCopilotChatConfiguration(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider agentId="provider_agent">
            <CopilotChatConfigurationProvider agentId="chat_agent">
              {children}
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        ),
      });

      expect(result.current?.agentId).toBe("chat_agent");
    });

    it("leaves the global default in place when the prop is omitted", () => {
      const { result } = renderHook(() => useCopilotChatConfiguration(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>
            <CopilotChatConfigurationProvider>
              {children}
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        ),
      });

      expect(result.current?.agentId).toBe(DEFAULT_AGENT_ID);
    });

    it("publishes no chat configuration of its own", () => {
      const { result } = renderHook(() => useCopilotChatConfiguration(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider agentId="my_agent">{children}</CopilotKitProvider>
        ),
      });

      expect(result.current).toBeNull();
    });

    it("follows a changed agentId", () => {
      let captured: string | undefined;

      function Collector() {
        captured = useCopilotChatConfiguration()?.agentId;
        return null;
      }

      const { rerender } = render(
        <CopilotKitProvider agentId="first_agent">
          <CopilotChatConfigurationProvider>
            <Collector />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );
      expect(captured).toBe("first_agent");

      rerender(
        <CopilotKitProvider agentId="second_agent">
          <CopilotChatConfigurationProvider>
            <Collector />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );
      expect(captured).toBe("second_agent");
    });

    // The agent default must NOT arrive through a root
    // `CopilotChatConfigurationProvider`: that provider also resolves a
    // threadId, so every chat under it would inherit one thread and two
    // sibling chats would share a transcript.
    describe("thread isolation", () => {
      beforeEach(async () => {
        const { randomUUID } = await import("@copilotkit/shared");
        let n = 0;
        vi.mocked(randomUUID).mockImplementation(() => `thread-uuid-${++n}`);
      });

      afterEach(async () => {
        const { randomUUID } = await import("@copilotkit/shared");
        vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
      });

      function renderSiblingChats(agentId?: string) {
        const threadIds: (string | undefined)[] = [];

        function Collector() {
          threadIds.push(useCopilotChatConfiguration()?.threadId);
          return null;
        }

        // Stands in for what `<CopilotChat>` renders: its own configuration
        // provider with no threadId prop.
        function Chat() {
          return (
            <CopilotChatConfigurationProvider>
              <Collector />
            </CopilotChatConfigurationProvider>
          );
        }

        render(
          <CopilotKitProvider agentId={agentId}>
            <Chat />
            <Chat />
          </CopilotKitProvider>,
        );

        return threadIds;
      }

      it("gives sibling chats their own thread when agentId is set", () => {
        const threadIds = renderSiblingChats("my_agent");

        expect(threadIds).toHaveLength(2);
        expect(new Set(threadIds).size).toBe(2);
      });

      it("matches the no-agentId tree", () => {
        const threadIds = renderSiblingChats();

        expect(new Set(threadIds).size).toBe(2);
      });
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
