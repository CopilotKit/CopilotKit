import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// --- Mock @copilotkit/core ---
const mockAddTool = vi.fn();
const mockRemoveTool = vi.fn();
const mockSetRuntimeUrl = vi.fn();
const mockSetRuntimeTransport = vi.fn();
const mockSetHeaders = vi.fn();
const mockSetProperties = vi.fn();
const mockSetAgents = vi.fn();

vi.mock("@copilotkit/core", async () => {
  const actual = await vi.importActual("@copilotkit/core");
  const CopilotKitCoreRuntimeConnectionStatus = {
    Disconnected: "disconnected",
    Connected: "connected",
    Connecting: "connecting",
    Error: "error",
  } as const;

  class MockCopilotKitCore {
    addTool = mockAddTool;
    removeTool = mockRemoveTool;
    setRuntimeUrl = mockSetRuntimeUrl;
    setRuntimeTransport = mockSetRuntimeTransport;
    setHeaders = mockSetHeaders;
    setProperties = mockSetProperties;
    setAgents__unsafe_dev_only = mockSetAgents;
    agents: Record<string, any> = {};
    runtimeUrl: string | undefined = undefined;
    runtimeTransport = "auto" as const;
    headers: Record<string, string> = {};
    threadEndpoints = undefined;
    intelligence = undefined;
    licenseStatus = undefined;
    a2uiEnabled = false;
    openGenerativeUIEnabled = false;
    runtimeConnectionStatus = CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    listener: any = undefined;
    defaultThrottleMs: number | undefined = undefined;
    subscribers: Set<any> = new Set();

    constructor(config: any) {
      // no-op
    }

    setDefaultThrottleMs(v: number | undefined) {
      this.defaultThrottleMs = v;
    }
    getAgent = vi.fn();
    addContext = vi.fn(() => "ctx-1");
    removeContext = vi.fn();
    addSuggestionsConfig = vi.fn();
    removeSuggestionsConfig = vi.fn();
    reloadSuggestions = vi.fn();
    clearSuggestions = vi.fn();
    getSuggestions = vi.fn(() => ({ suggestions: [], isLoading: false }));
    getTool = vi.fn();
    setDebug = vi.fn();
    setCredentials = vi.fn();
    buildFrontendTools = vi.fn(() => []);
    getContextForAgent = vi.fn(() => []);

    subscribe(subscriber: any) {
      this.subscribers.add(subscriber);
      return {
        unsubscribe: () => {
          this.subscribers.delete(subscriber);
        },
      };
    }

    async notifySubscribers(
      handler: (subscriber: any) => void | Promise<void>,
      _errorMessage: string,
    ): Promise<void> {
      await Promise.all(
        Array.from(this.subscribers).map(async (subscriber) => {
          try {
            await handler(subscriber);
          } catch {
            // swallow
          }
        }),
      );
    }
  }

  return {
    ...(actual as any),
    CopilotKitCore: MockCopilotKitCore as any,
    CopilotKitCoreRuntimeConnectionStatus,
  };
});

// --- Now import modules that depend on the mock ---
import { CopilotKitCoreSvelte } from "../lib/svelte-core";

describe("CopilotKitCoreSvelte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs and stores Svelte-specific render configs", () => {
    const core = new CopilotKitCoreSvelte({
      runtimeUrl: "https://runtime.local",
      renderToolCalls: [],
      renderActivityMessages: [],
      renderCustomMessages: [],
    });

    expect(core).toBeInstanceOf(CopilotKitCoreSvelte);
    expect(core.propRenderToolCalls).toEqual([]);
    expect(core.renderActivityMessages).toEqual([]);
    expect(core.renderCustomMessages).toEqual([]);
  });

  it("stores render configs from constructor", () => {
    const renderToolCall = { name: "test", args: z.any(), render: () => {} };
    const renderActivity = {
      activityType: "test",
      content: z.any(),
      render: () => {},
    };
    const renderCustom = { render: () => {} };

    const core = new CopilotKitCoreSvelte({
      renderToolCalls: [renderToolCall],
      renderActivityMessages: [renderActivity],
      renderCustomMessages: [renderCustom],
    });

    expect(core.propRenderToolCalls).toHaveLength(1);
    expect(core.renderActivityMessages).toHaveLength(1);
    expect(core.renderCustomMessages).toHaveLength(1);
  });

  it("merges prop and hook render tool calls", () => {
    const propRenderer = {
      name: "toolA",
      args: z.any(),
      render: () => "prop",
      agentId: undefined,
    };
    const hookRenderer = {
      name: "toolB",
      args: z.any(),
      render: () => "hook",
      agentId: undefined,
    };

    const core = new CopilotKitCoreSvelte({
      renderToolCalls: [propRenderer],
    });
    core.addHookRenderToolCall(hookRenderer);

    const merged = core.renderToolCalls;
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "toolA" }),
        expect.objectContaining({ name: "toolB" }),
      ]),
    );
  });

  it("deduplicates hook render tool calls by (agentId, name)", () => {
    const r1 = {
      name: "toolA",
      args: z.any(),
      render: () => "first",
      agentId: "agent-1",
    };
    const r2 = {
      name: "toolA",
      args: z.any(),
      render: () => "second",
      agentId: "agent-1",
    };

    const core = new CopilotKitCoreSvelte({});
    core.addHookRenderToolCall(r1);
    core.addHookRenderToolCall(r2);

    expect(core.renderToolCalls).toHaveLength(1);
    expect(core.renderToolCalls![0].render).toBe(r2.render);
  });

  it("removes hook render tool calls", () => {
    const r1 = {
      name: "toolA",
      args: z.any(),
      render: () => "a",
      agentId: undefined,
    };
    const r2 = {
      name: "toolB",
      args: z.any(),
      render: () => "b",
      agentId: undefined,
    };

    const core = new CopilotKitCoreSvelte({});
    core.addHookRenderToolCall(r1);
    core.addHookRenderToolCall(r2);
    core.removeHookRenderToolCall("toolA");

    expect(core.renderToolCalls).toHaveLength(1);
    expect(core.renderToolCalls![0].name).toBe("toolB");
  });

  it("sets render tool calls from props and invalidates cache", () => {
    const core = new CopilotKitCoreSvelte({});
    const r1 = { name: "t1", args: z.any(), render: () => {} };
    const r2 = { name: "t2", args: z.any(), render: () => {} };

    core.setRenderToolCalls([r1, r2]);
    expect(core.propRenderToolCalls).toHaveLength(2);
    expect(core.renderToolCalls).toHaveLength(2);

    core.setRenderToolCalls([]);
    expect(core.propRenderToolCalls).toHaveLength(0);
  });

  it("sets activity message renderers", () => {
    const core = new CopilotKitCoreSvelte({});
    const r = { activityType: "custom", content: z.any(), render: () => {} };
    core.setRenderActivityMessages([r]);
    expect(core.renderActivityMessages).toHaveLength(1);
  });

  it("sets custom message renderers and notifies subscribers", () => {
    const core = new CopilotKitCoreSvelte({});
    const subSpy = vi.fn();
    core.subscribe({
      onRenderCustomMessagesChanged: subSpy,
    } as any);

    const r = { render: () => {} };
    core.setRenderCustomMessages([r]);

    expect(core.renderCustomMessages).toHaveLength(1);
    expect(subSpy).toHaveBeenCalledTimes(1);
  });

  it("tracks interrupt state and notifies subscribers", () => {
    const core = new CopilotKitCoreSvelte({});
    const subSpy = vi.fn();
    core.subscribe({ onInterruptStateChanged: subSpy } as any);

    core.setInterruptState({ event: { name: "test", value: "x" } } as any);
    expect(core.interruptState).toBeTruthy();
    expect(subSpy).toHaveBeenCalledTimes(1);

    core.setInterruptState(null);
    expect(core.interruptState).toBeNull();
    expect(subSpy).toHaveBeenCalledTimes(2);
  });

  it("calls waitForPendingFrameworkUpdates which awaits tick", async () => {
    const core = new CopilotKitCoreSvelte({});
    await expect(core.waitForPendingFrameworkUpdates()).resolves.toBeUndefined();
  });

  it("removes tools via delegate to base class", () => {
    const core = new CopilotKitCoreSvelte({});
    core.removeTool("myTool", "agent-1");
    expect(mockRemoveTool).toHaveBeenCalledWith("myTool", "agent-1");
  });

  it("adds tools via delegate to base class", () => {
    const core = new CopilotKitCoreSvelte({});
    const tool = { name: "myTool", handler: vi.fn() } as any;
    core.addTool(tool);
    expect(mockAddTool).toHaveBeenCalledWith(tool);
  });

  it("sets defaultThrottleMs", () => {
    const core = new CopilotKitCoreSvelte({});
    core.setDefaultThrottleMs(100);
    // The mock stores it, but we can also verify no crash
    expect(() => core.setDefaultThrottleMs(0)).not.toThrow();
    expect(() => core.setDefaultThrottleMs(undefined)).not.toThrow();
  });

  it("subscribes with custom subscriber type", () => {
    const core = new CopilotKitCoreSvelte({});
    const sub = core.subscribe({});
    expect(sub).toHaveProperty("unsubscribe");
    expect(typeof sub.unsubscribe).toBe("function");
  });
});
