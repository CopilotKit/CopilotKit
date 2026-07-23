import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Track the agentId passed to useAgent across renders
let capturedAgentId: string | undefined;

const hoisted = vi.hoisted(() => {
  const _React = require("react");
  return {
    RealContext: _React.createContext(null),
    MockCoreConstructor: vi.fn(),
  };
});

let unsubscribeMock: ReturnType<typeof vi.fn>;

function createMockCore() {
  return {
    subscribe: vi.fn((_subscriber: any) => ({
      unsubscribe: unsubscribeMock,
    })),
    subscribeToAgentWithOptions: vi.fn((_agent: any, _handlers: any) => ({
      unsubscribe: vi.fn(),
    })),
    setRuntimeUrl: vi.fn(),
    setRuntimeTransport: vi.fn(),
    setHeaders: vi.fn(),
    setCredentials: vi.fn(),
    setProperties: vi.fn(),
    setDebug: vi.fn(),
    setDefaultThrottleMs: vi.fn(),
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
  function CopilotKitCoreReact(this: any, ...args: any[]) {
    hoisted.MockCoreConstructor(...args);
    const instance = hoisted.MockCoreConstructor.mock.results.at(-1)?.value;
    if (instance) Object.assign(this, instance);
  }
  return {
    CopilotKitCoreReact,
    useAgent: (props: any) => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      capturedAgentId = props?.agentId;
      return { agent: {} };
    },
    useFrontendTool: () => {},
    useComponent: () => {},
    useHumanInTheLoop: () => {},
    useInterrupt: () => {},
    useSuggestions: () => {},
    useConfigureSuggestions: () => {},
    useAgentContext: () => {},
    useThreads: () => ({
      threads: [],
      isLoading: false,
      error: null,
      hasMoreThreads: false,
      isFetchingMoreThreads: false,
      fetchMoreThreads: () => {},
      renameThread: async () => {},
      archiveThread: async () => {},
      deleteThread: async () => {},
    }),
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
  DEFAULT_AGENT_ID: "default",
  createLicenseContextValue: () => ({
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  }),
}));

// Import after mocks
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";
import { CopilotModal } from "../CopilotModal";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotChat agentId resolution", () => {
  beforeEach(() => {
    capturedAgentId = undefined;
    unsubscribeMock = vi.fn();
    mockCoreInstance = createMockCore();
    hoisted.MockCoreConstructor.mockClear();
    hoisted.MockCoreConstructor.mockReturnValue(mockCoreInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses agentId when provided", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="my-agent" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("my-agent");
  });

  it("falls back to agentName when agentId is not provided", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentName="legacy-agent" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("legacy-agent");
  });

  it("agentId takes priority over agentName when both provided", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="primary" agentName="legacy" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("primary");
  });

  it("falls back to DEFAULT_AGENT_ID when neither provided", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("default");
  });

  it("logs deprecation warning when agentName is used without agentId", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentName="old-name" />
      </CopilotKitProvider>,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "[CopilotKit] agentName is deprecated, use agentId instead",
    );

    warnSpy.mockRestore();
  });

  it("does not log deprecation warning when agentId is used", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="my-agent" />
      </CopilotKitProvider>,
    );

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("does not log deprecation warning when both agentId and agentName are provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="primary" agentName="legacy" />
      </CopilotKitProvider>,
    );

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("renders children", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="my-agent">
          <span>Hello Chat</span>
        </CopilotChat>
      </CopilotKitProvider>,
    );

    expect(getByText("Hello Chat")).toBeTruthy();
  });
});

describe("CopilotModal agentId resolution", () => {
  beforeEach(() => {
    capturedAgentId = undefined;
    unsubscribeMock = vi.fn();
    mockCoreInstance = createMockCore();
    hoisted.MockCoreConstructor.mockClear();
    hoisted.MockCoreConstructor.mockReturnValue(mockCoreInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses agentId when provided", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotModal agentId="modal-agent" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("modal-agent");
  });

  it("falls back to agentName for backwards compatibility", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotModal agentName="legacy-modal" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("legacy-modal");
  });

  it("agentId takes priority over agentName", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotModal agentId="new" agentName="old" />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("new");
  });

  it("logs deprecation warning when agentName used without agentId", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotModal agentName="old-modal" />
      </CopilotKitProvider>,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "[CopilotKit] agentName is deprecated, use agentId instead",
    );

    warnSpy.mockRestore();
  });
});
