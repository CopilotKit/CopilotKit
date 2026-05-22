import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import {
  RenderToolProvider,
  useRenderToolRegistry,
} from "../RenderToolContext";

// Minimal wrapper that provides both CopilotKit context and RenderToolProvider
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
      <RenderToolProvider>{children}</RenderToolProvider>
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

  it("stores render function in the registry", () => {
    let registry: Map<string, any> | null = null;
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    const renderFn = ({ args, status }: any) =>
      React.createElement("View", null, `${status}`);

    function ToolRegistrar() {
      useRenderTool({
        name: "weather-tool",
        description: "Show weather",
        parameters: mockSchema as any,
        render: renderFn,
      });
      return null;
    }

    function RegistryReader() {
      registry = useRenderToolRegistry();
      return null;
    }

    render(
      <TestProviders>
        <ToolRegistrar />
        <RegistryReader />
      </TestProviders>,
    );

    expect(registry).not.toBeNull();
    expect(registry!.has("weather-tool")).toBe(true);
    // The stored function is a stable wrapper, not the original
    expect(typeof registry!.get("weather-tool")).toBe("function");
  });

  it("render function in registry produces expected output", () => {
    let registry: Map<string, any> | null = null;
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    function ToolRegistrar() {
      useRenderTool({
        name: "greeting-tool",
        description: "Greet someone",
        parameters: mockSchema as any,
        render: ({ args, status }) =>
          React.createElement("Text", null, `Hello ${status}`),
      });
      return null;
    }

    function RegistryReader() {
      registry = useRenderToolRegistry();
      return null;
    }

    render(
      <TestProviders>
        <ToolRegistrar />
        <RegistryReader />
      </TestProviders>,
    );

    const renderFn = registry!.get("greeting-tool");
    const element = renderFn({ args: {}, status: "executing" });
    expect(element).not.toBeNull();
    expect(element.type).toBe("Text");
    expect(element.props.children).toBe("Hello executing");
  });

  it("throws when useRenderTool is called outside RenderToolProvider", () => {
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    function TestComponent() {
      useRenderTool({
        name: "orphan-tool",
        description: "No provider",
        parameters: mockSchema as any,
        render: () => React.createElement("View"),
      });
      return null;
    }

    // Need CopilotKit context but no RenderToolProvider
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(
        <hoisted.RealContext.Provider
          value={{ copilotkit: {}, executingToolCallIds: new Set() } as any}
        >
          <TestComponent />
        </hoisted.RealContext.Provider>,
      );
    }).toThrow("useRenderTool must be used within a RenderToolProvider");

    spy.mockRestore();
  });

  it("throws when useRenderToolRegistry is called outside RenderToolProvider", () => {
    function TestComponent() {
      useRenderToolRegistry();
      return null;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow(
      "useRenderToolRegistry must be used within a RenderToolProvider",
    );

    spy.mockRestore();
  });

  it("unregisters the render function on unmount", () => {
    let registry: Map<string, any> | null = null;
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    function ToolRegistrar() {
      useRenderTool({
        name: "ephemeral-tool",
        description: "Will unmount",
        parameters: mockSchema as any,
        render: () => React.createElement("View"),
      });
      return null;
    }

    function RegistryReader() {
      registry = useRenderToolRegistry();
      return null;
    }

    const { rerender } = render(
      <TestProviders>
        <ToolRegistrar />
        <RegistryReader />
      </TestProviders>,
    );

    expect(registry!.has("ephemeral-tool")).toBe(true);

    // Re-render without the ToolRegistrar
    rerender(
      <TestProviders>
        <RegistryReader />
      </TestProviders>,
    );

    expect(registry!.has("ephemeral-tool")).toBe(false);
  });

  it("supports multiple tools registered simultaneously", () => {
    let registry: Map<string, any> | null = null;
    const mockSchema = { "~standard": { vendor: "test", version: 1 } };

    function ToolA() {
      useRenderTool({
        name: "tool-a",
        description: "Tool A",
        parameters: mockSchema as any,
        render: () => React.createElement("View"),
      });
      return null;
    }

    function ToolB() {
      useRenderTool({
        name: "tool-b",
        description: "Tool B",
        parameters: mockSchema as any,
        render: () => React.createElement("View"),
      });
      return null;
    }

    function RegistryReader() {
      registry = useRenderToolRegistry();
      return null;
    }

    render(
      <TestProviders>
        <ToolA />
        <ToolB />
        <RegistryReader />
      </TestProviders>,
    );

    expect(registry!.has("tool-a")).toBe(true);
    expect(registry!.has("tool-b")).toBe(true);
    expect(registry!.size).toBe(2);
  });
});
