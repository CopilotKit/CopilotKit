import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  const _React = require("react");
  return {
    RealContext: _React.createContext(null),
    mockAddTool: vi.fn(),
    mockRemoveTool: vi.fn(),
    mockGetTool: vi.fn(() => undefined),
    mockAddHookRenderToolCall: vi.fn(),
    mockSubscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  };
});

vi.mock("@copilotkit/react-core/v2/headless", () => {
  return {
    useFrontendTool: vi.fn((_tool: any, _deps?: any) => {
      // Require context — mirrors real behavior
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      // Simulate addTool call
      hoisted.mockAddTool(_tool);
      // Faithful to react-core: a tool that carries a render lands in the
      // canonical `renderToolCalls` registry. RN's convergence depends on
      // exactly this, so the double must model it.
      if (_tool.render && ctx.copilotkit?.setRenderToolCalls) {
        ctx.copilotkit.setRenderToolCalls([
          ...ctx.copilotkit.renderToolCalls,
          { name: _tool.name, render: _tool.render },
        ]);
      }
    }),
    CopilotKitCoreReact: function CopilotKitCoreReact() {},
    CopilotChatConfigurationProvider: ({ children }: any) => children,
    useCopilotChatConfiguration: () => null,
    CopilotChatDefaultLabels: {},
  };
});

vi.mock("@copilotkit/react-core/v2/context", () => {
  const _React = require("react");
  return {
    CopilotKitContext: hoisted.RealContext,
    LicenseContext: _React.createContext({
      status: null,
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
    useCopilotKit: () => {
      const ctx = _React.useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      return ctx;
    },
    useLicenseContext: () => ({
      status: null,
      license: null,
      checkFeature: () => true,
      getLimit: () => null,
    }),
  };
});

vi.mock("@copilotkit/shared", () => ({
  createLicenseContextValue: () => ({
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  }),
}));

// Import after mocks
import { useRenderTool } from "../useRenderTool";

// Minimal wrapper that provides the CopilotKit context. There is no longer a
// RenderToolProvider — useRenderTool registers directly into core's registry.
function TestProviders({ children }: { children: React.ReactNode }) {
  const mockCtx = {
    copilotkit: {
      addTool: hoisted.mockAddTool,
      removeTool: hoisted.mockRemoveTool,
      getTool: hoisted.mockGetTool,
      addHookRenderToolCall: hoisted.mockAddHookRenderToolCall,
      subscribe: hoisted.mockSubscribe,
    },
    executingToolCallIds: new Set<string>(),
  };

  return (
    <hoisted.RealContext.Provider value={mockCtx as any}>
      {children}
    </hoisted.RealContext.Provider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRenderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool via useFrontendTool", () => {
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    function TestComponent() {
      useRenderTool({
        name: "test-render-tool",
        description: "A tool with render",
        parameters: mockSchema as any,
        render: ({ args, status }) =>
          React.createElement("View", null, `${status}`),
        handler: async () => "done",
      });
      return null;
    }

    render(
      <TestProviders>
        <TestComponent />
      </TestProviders>,
    );

    // useFrontendTool should have been called with the tool config
    expect(hoisted.mockAddTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "test-render-tool",
        description: "A tool with render",
      }),
    );
  });
});

describe("useRenderTool registry target", () => {
  it("registers its renderer into core's renderToolCalls, not a local map", () => {
    // The whole point of the convergence: one registry. react-core's
    // useRenderToolCall reads copilotkit.renderToolCalls, so a renderer that
    // does not land there renders nowhere outside RN's own chat.
    const copilotkit = {
      renderToolCalls: [] as any[],
      addTool: vi.fn(),
      removeTool: vi.fn(),
      setRenderToolCalls(next: any[]) {
        this.renderToolCalls = next;
      },
    };

    function Probe() {
      useRenderTool({
        name: "showWeather",
        description: "Show weather",
        parameters: z.object({ city: z.string() }),
        render: () => null,
      });
      return null;
    }

    render(
      <hoisted.RealContext.Provider value={{ copilotkit } as any}>
        <Probe />
      </hoisted.RealContext.Provider>,
    );

    expect(copilotkit.renderToolCalls.map((r) => r.name)).toContain(
      "showWeather",
    );
  });
});
