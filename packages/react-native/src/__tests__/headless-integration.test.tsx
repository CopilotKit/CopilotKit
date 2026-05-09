import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.hoisted runs before vi.mock factories, making these available to both
const hoisted = vi.hoisted(() => {
  const _React = require("react");
  return {
    RealContext: _React.createContext(null),
    MockCoreConstructor: vi.fn(),
  };
});

let _capturedSubscriber: Record<string, (...args: any[]) => void>;
let unsubscribeMock: ReturnType<typeof vi.fn>;

function createMockCore() {
  return {
    subscribe: vi.fn((subscriber: any) => {
      _capturedSubscriber = subscriber;
      return { unsubscribe: unsubscribeMock };
    }),
    subscribeToAgentWithOptions: vi.fn((_agent: any, _handlers: any) => ({
      unsubscribe: vi.fn(),
    })),
    setRuntimeUrl: vi.fn(),
    setRuntimeTransport: vi.fn(),
    setHeaders: vi.fn(),
    setProperties: vi.fn(),
    getAgent: vi.fn(() => undefined),
    runtimeUrl: "https://api.test",
    runtimeTransport: "auto",
    runtimeConnectionStatus: "Disconnected",
    headers: {},
    agents: {},
    defaultThrottleMs: undefined,
    addTool: vi.fn(),
    removeTool: vi.fn(),
    getTool: vi.fn(() => undefined),
    addHookRenderToolCall: vi.fn(),
    registerThreadStore: vi.fn(),
    unregisterThreadStore: vi.fn(),
    intelligence: undefined,
  };
}

let mockCoreInstance: ReturnType<typeof createMockCore>;

vi.mock("@copilotkit/react-core/v2/headless", () => {
  // Regular function (not arrow) so it's new-able
  function CopilotKitCoreReact(this: any, ...args: any[]) {
    hoisted.MockCoreConstructor(...args);
    const instance = hoisted.MockCoreConstructor.mock.results.at(-1)?.value;
    if (instance) Object.assign(this, instance);
  }
  return {
    CopilotKitCoreReact,
    useAgent: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      return { agent: {} };
    },
    useFrontendTool: (_tool: any) => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useComponent: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useHumanInTheLoop: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useInterrupt: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useSuggestions: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useConfigureSuggestions: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useAgentContext: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
    },
    useThreads: (_input: any) => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      return {
        threads: [],
        isLoading: false,
        error: null,
        hasMoreThreads: false,
        isFetchingMoreThreads: false,
        fetchMoreThreads: () => {},
        renameThread: async () => {},
        archiveThread: async () => {},
        deleteThread: async () => {},
      };
    },
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
import { CopilotKitProvider } from "../CopilotKitProvider";
import {
  useAgent,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt,
  useThreads,
} from "../index";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Headless integration", () => {
  beforeEach(() => {
    unsubscribeMock = vi.fn();
    mockCoreInstance = createMockCore();
    hoisted.MockCoreConstructor.mockClear();
    hoisted.MockCoreConstructor.mockReturnValue(mockCoreInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Provider + hooks integration ──────────────────────────────────────

  describe("provider + hooks integration", () => {
    it("useAgent returns expected shape when called inside provider", () => {
      let result: any = null;

      function TestComponent() {
        result = useAgent();
        return null;
      }

      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <TestComponent />
        </CopilotKitProvider>,
      );

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("agent");
      expect(typeof result.agent).toBe("object");
    });

    it("useFrontendTool can register a tool without error", () => {
      function TestComponent() {
        useFrontendTool({
          name: "test-tool",
          description: "A test tool",
          parameters: {},
          handler: async () => "done",
        });
        return null;
      }

      // Should not throw
      expect(() => {
        render(
          <CopilotKitProvider runtimeUrl="https://api.test">
            <TestComponent />
          </CopilotKitProvider>,
        );
      }).not.toThrow();
    });

    it("useThreads returns thread state when called inside provider", () => {
      let result: any = null;

      function TestComponent() {
        result = useThreads({ agentId: "test-agent" });
        return null;
      }

      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <TestComponent />
        </CopilotKitProvider>,
      );

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("threads");
      expect(result).toHaveProperty("isLoading");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("renameThread");
      expect(result).toHaveProperty("archiveThread");
      expect(result).toHaveProperty("deleteThread");
      expect(result).toHaveProperty("hasMoreThreads");
      expect(result).toHaveProperty("isFetchingMoreThreads");
      expect(result).toHaveProperty("fetchMoreThreads");
      expect(Array.isArray(result.threads)).toBe(true);
      expect(typeof result.renameThread).toBe("function");
      expect(typeof result.archiveThread).toBe("function");
      expect(typeof result.deleteThread).toBe("function");
    });

    it("multiple hooks can coexist in the same provider tree", () => {
      let agentResult: any = null;
      let threadsResult: any = null;

      function TestComponent() {
        agentResult = useAgent();
        threadsResult = useThreads({ agentId: "test-agent" });
        useFrontendTool({
          name: "multi-tool",
          description: "Another tool",
          parameters: {},
          handler: async () => "ok",
        });
        return null;
      }

      expect(() => {
        render(
          <CopilotKitProvider runtimeUrl="https://api.test">
            <TestComponent />
          </CopilotKitProvider>,
        );
      }).not.toThrow();

      expect(agentResult).toHaveProperty("agent");
      expect(threadsResult).toHaveProperty("threads");
    });
  });

  // ── Provider error boundary ───────────────────────────────────────────

  describe("provider error boundary", () => {
    it("useAgent throws when called outside CopilotKitProvider", () => {
      function TestComponent() {
        useAgent();
        return null;
      }

      // Suppress React error boundary console output
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useCopilotKit must be used within CopilotKitProvider");

      spy.mockRestore();
    });

    it("useFrontendTool throws when called outside CopilotKitProvider", () => {
      function TestComponent() {
        useFrontendTool({
          name: "orphan-tool",
          description: "No provider",
          parameters: {},
          handler: async () => "fail",
        });
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useCopilotKit must be used within CopilotKitProvider");

      spy.mockRestore();
    });

    it("useThreads throws when called outside CopilotKitProvider", () => {
      function TestComponent() {
        useThreads({ agentId: "test-agent" });
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useCopilotKit must be used within CopilotKitProvider");

      spy.mockRestore();
    });

    it("useHumanInTheLoop throws when called outside CopilotKitProvider", () => {
      function TestComponent() {
        useHumanInTheLoop();
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useCopilotKit must be used within CopilotKitProvider");

      spy.mockRestore();
    });

    it("useInterrupt throws when called outside CopilotKitProvider", () => {
      function TestComponent() {
        useInterrupt();
        return null;
      }

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useCopilotKit must be used within CopilotKitProvider");

      spy.mockRestore();
    });
  });

});
