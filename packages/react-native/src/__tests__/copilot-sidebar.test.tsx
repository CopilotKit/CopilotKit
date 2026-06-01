import React, { createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
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
  randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2, 8),
  getModalityFromMimeType: (mimeType: string) => {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    return "document";
  },
  formatFileSize: (bytes: number) => `${bytes} B`,
  createLicenseContextValue: () => ({
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  }),
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));
vi.mock("expo-file-system", () => ({
  readAsStringAsync: vi.fn().mockResolvedValue("base64data"),
  EncodingType: { Base64: "base64" },
}));

// Mock react-native since tests run in jsdom
vi.mock("react-native", () => {
  const _React = require("react");

  // Minimal Animated.Value mock
  class MockAnimatedValue {
    _value: number;
    constructor(v: number) {
      this._value = v;
    }
    setValue(v: number) {
      this._value = v;
    }
  }

  return {
    Animated: {
      View: _React.forwardRef((props: any, ref: any) => {
        const { testID, ...rest } = props;
        return _React.createElement("div", {
          ...rest,
          ref,
          "data-testid": testID,
        });
      }),
      Value: MockAnimatedValue,
      timing: (_value: any, _config: any) => ({
        start: (cb?: (result: { finished: boolean }) => void) => {
          cb?.({ finished: true });
        },
      }),
    },
    Pressable: _React.forwardRef((props: any, ref: any) => {
      const { onPress, testID, children, ...rest } = props;
      return _React.createElement(
        "button",
        { ...rest, ref, onClick: onPress, "data-testid": testID },
        children,
      );
    }),
    View: _React.forwardRef((props: any, ref: any) => {
      const { testID, ...rest } = props;
      return _React.createElement("div", {
        ...rest,
        ref,
        "data-testid": testID,
      });
    }),
    Text: _React.forwardRef((props: any, ref: any) =>
      _React.createElement("span", { ...props, ref }),
    ),
    Dimensions: {
      get: () => ({ width: 400, height: 800 }),
    },
    StyleSheet: {
      create: (styles: any) => styles,
      absoluteFillObject: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      },
      hairlineWidth: 1,
    },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  };
});

// Import after mocks
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotSidebar } from "../CopilotSidebar";
import type { CopilotSidebarHandle } from "../CopilotSidebar";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotSidebar", () => {
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

  it("renders without crashing", () => {
    const { container } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar />
      </CopilotKitProvider>,
    );

    expect(container).toBeTruthy();
  });

  it("renders the FAB toggle button by default when closed", () => {
    const { getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar />
      </CopilotKitProvider>,
    );

    expect(getByTestId("copilot-sidebar-fab")).toBeTruthy();
  });

  it("hides the FAB when showToggleButton is false", () => {
    const { queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar showToggleButton={false} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-sidebar-fab")).toBeNull();
  });

  it("defaultOpen=true renders the drawer immediately", () => {
    const { getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();
    expect(getByTestId("copilot-sidebar-backdrop")).toBeTruthy();
  });

  it("defaultOpen=false does not render the drawer", () => {
    const { queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen={false} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();
    expect(queryByTestId("copilot-sidebar-backdrop")).toBeNull();
  });

  it("open() imperative method opens the drawer", () => {
    const ref = createRef<CopilotSidebarHandle>();

    const { queryByTestId, getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar ref={ref} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();

    act(() => {
      ref.current!.open();
    });

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();
  });

  it("close() imperative method closes the drawer", () => {
    const ref = createRef<CopilotSidebarHandle>();

    const { queryByTestId, getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar ref={ref} defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();

    act(() => {
      ref.current!.close();
    });

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();
  });

  it("toggle() imperative method toggles the drawer", () => {
    const ref = createRef<CopilotSidebarHandle>();

    const { queryByTestId, getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar ref={ref} />
      </CopilotKitProvider>,
    );

    // Initially closed
    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();

    // Toggle open
    act(() => {
      ref.current!.toggle();
    });
    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();

    // Toggle closed
    act(() => {
      ref.current!.toggle();
    });
    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();
  });

  it("forwards agentId to CopilotChat", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar agentId="sidebar-agent" defaultOpen />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("sidebar-agent");
  });

  it("forwards agentName to CopilotChat as deprecated alias", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar agentName="legacy-sidebar" defaultOpen />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("legacy-sidebar");
  });

  it("agentId takes priority over agentName", () => {
    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar agentId="primary" agentName="legacy" defaultOpen />
      </CopilotKitProvider>,
    );

    expect(capturedAgentId).toBe("primary");
  });

  it("renders custom headerTitle", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar headerTitle="My Assistant" defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByText("My Assistant")).toBeTruthy();
  });

  it("renders default header title when not specified", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByText("Copilot")).toBeTruthy();
  });

  it("FAB click opens the drawer", () => {
    const { getByTestId, queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();

    fireEvent.click(getByTestId("copilot-sidebar-fab"));

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();
  });

  it("close button click closes the drawer", () => {
    const { getByTestId, queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();

    fireEvent.click(getByTestId("copilot-sidebar-close"));

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();
  });

  it("backdrop click closes the drawer", () => {
    const { getByTestId, queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen />
      </CopilotKitProvider>,
    );

    expect(getByTestId("copilot-sidebar-drawer")).toBeTruthy();

    fireEvent.click(getByTestId("copilot-sidebar-backdrop"));

    expect(queryByTestId("copilot-sidebar-drawer")).toBeNull();
  });

  it("renders children inside the drawer", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar defaultOpen>
          <span>Custom Content</span>
        </CopilotSidebar>
      </CopilotKitProvider>,
    );

    expect(getByText("Custom Content")).toBeTruthy();
  });

  it("calls onOpen callback when drawer opens", () => {
    const onOpen = vi.fn();
    const ref = createRef<CopilotSidebarHandle>();

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar ref={ref} onOpen={onOpen} />
      </CopilotKitProvider>,
    );

    act(() => {
      ref.current!.open();
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("calls onClose callback when drawer closes", () => {
    const onClose = vi.fn();
    const ref = createRef<CopilotSidebarHandle>();

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotSidebar ref={ref} defaultOpen onClose={onClose} />
      </CopilotKitProvider>,
    );

    act(() => {
      ref.current!.close();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("attachments prop forwarding", () => {
    it("forwards attachments config to CopilotChat via rest props", () => {
      expect(() => {
        render(
          <CopilotKitProvider runtimeUrl="https://api.test">
            <CopilotSidebar
              defaultOpen={true}
              attachments={{ enabled: true }}
            />
          </CopilotKitProvider>,
        );
      }).not.toThrow();
    });
  });
});
