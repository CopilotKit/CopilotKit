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

// Mock React Native components for jsdom environment
vi.mock("react-native", () => {
  const _React = require("react");

  // Simple mock components that render as divs with testIDs
  const Modal = ({ children, visible, testID, onRequestClose }: any) => {
    if (!visible) return null;
    return _React.createElement(
      "div",
      { "data-testid": testID, "data-visible": visible },
      children,
    );
  };

  const View = ({ children, style, testID }: any) =>
    _React.createElement("div", { "data-testid": testID, style }, children);

  const Text = ({ children, style, testID }: any) =>
    _React.createElement("span", { "data-testid": testID, style }, children);

  const TouchableOpacity = ({
    children,
    onPress,
    testID,
    accessibilityLabel,
    style,
  }: any) =>
    _React.createElement(
      "button",
      {
        "data-testid": testID,
        onClick: onPress,
        "aria-label": accessibilityLabel,
        style,
      },
      children,
    );

  const Pressable = ({ children, onPress, testID, style }: any) =>
    _React.createElement(
      "div",
      { "data-testid": testID, onClick: onPress, style },
      children,
    );

  const Animated = {
    View,
    Text,
    createAnimatedComponent: (comp: any) => comp,
    timing: () => ({ start: (cb?: any) => cb?.() }),
    spring: () => ({ start: (cb?: any) => cb?.() }),
    Value: class {
      _value: number;
      constructor(v: number) {
        this._value = v;
      }
      setValue(v: number) {
        this._value = v;
      }
      interpolate() {
        return this;
      }
    },
  };

  const StyleSheet = {
    create: (styles: any) => styles,
    hairlineWidth: 1,
  };

  const useWindowDimensions = () => ({ width: 375, height: 812 });

  return {
    Modal,
    View,
    Text,
    TouchableOpacity,
    Pressable,
    Animated,
    StyleSheet,
    useWindowDimensions,
    Platform: { OS: "ios" },
  };
});

// Import after mocks
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotPopup } from "../CopilotPopup";
import type { CopilotPopupHandle } from "../CopilotPopup";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotPopup", () => {
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
        <CopilotPopup />
      </CopilotKitProvider>,
    );

    expect(container).toBeTruthy();
  });

  it("shows FAB when closed and hides FAB when open", () => {
    const { queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup defaultOpen={false} />
      </CopilotKitProvider>,
    );

    // FAB should be visible when popup is closed
    expect(queryByTestId("copilot-popup-fab")).toBeTruthy();
    // Modal should not be visible
    expect(queryByTestId("copilot-popup-modal")).toBeNull();
  });

  describe("defaultOpen", () => {
    it("starts closed by default", () => {
      const { queryByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup />
        </CopilotKitProvider>,
      );

      // FAB visible = popup closed
      expect(queryByTestId("copilot-popup-fab")).toBeTruthy();
      expect(queryByTestId("copilot-popup-modal")).toBeNull();
    });

    it("starts open when defaultOpen=true", () => {
      const { queryByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup defaultOpen={true} />
        </CopilotKitProvider>,
      );

      // Modal should be visible when defaultOpen is true
      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();
      // FAB should be hidden when popup is open
      expect(queryByTestId("copilot-popup-fab")).toBeNull();
    });
  });

  describe("imperative handle", () => {
    it("open() makes the popup visible", () => {
      const ref = createRef<CopilotPopupHandle>();

      const { queryByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup ref={ref} defaultOpen={false} />
        </CopilotKitProvider>,
      );

      // Initially closed
      expect(queryByTestId("copilot-popup-modal")).toBeNull();

      // Call open()
      act(() => {
        ref.current!.open();
      });

      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();
    });

    it("close() hides the popup", () => {
      const ref = createRef<CopilotPopupHandle>();

      const { queryByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup ref={ref} defaultOpen={true} />
        </CopilotKitProvider>,
      );

      // Initially open
      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();

      // Call close()
      act(() => {
        ref.current!.close();
      });

      expect(queryByTestId("copilot-popup-modal")).toBeNull();
    });

    it("toggle() switches the popup state", () => {
      const ref = createRef<CopilotPopupHandle>();

      const { queryByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup ref={ref} defaultOpen={false} />
        </CopilotKitProvider>,
      );

      // Initially closed
      expect(queryByTestId("copilot-popup-modal")).toBeNull();

      // Toggle open
      act(() => {
        ref.current!.toggle();
      });
      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();

      // Toggle closed
      act(() => {
        ref.current!.toggle();
      });
      expect(queryByTestId("copilot-popup-modal")).toBeNull();
    });
  });

  describe("dismissOnBackdropPress", () => {
    it("closes when backdrop is pressed (default behavior)", () => {
      const ref = createRef<CopilotPopupHandle>();

      const { queryByTestId, getByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup ref={ref} defaultOpen={true} />
        </CopilotKitProvider>,
      );

      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();

      // Click the backdrop
      act(() => {
        fireEvent.click(getByTestId("copilot-popup-backdrop"));
      });

      expect(queryByTestId("copilot-popup-modal")).toBeNull();
    });

    it("does NOT close when dismissOnBackdropPress=false", () => {
      const ref = createRef<CopilotPopupHandle>();

      const { queryByTestId, getByTestId } = render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup
            ref={ref}
            defaultOpen={true}
            dismissOnBackdropPress={false}
          />
        </CopilotKitProvider>,
      );

      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();

      // Click the backdrop — should NOT close
      act(() => {
        fireEvent.click(getByTestId("copilot-popup-backdrop"));
      });

      expect(queryByTestId("copilot-popup-modal")).toBeTruthy();
    });
  });

  describe("agentId forwarding", () => {
    it("forwards agentId to CopilotChat", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup agentId="popup-agent" defaultOpen={true} />
        </CopilotKitProvider>,
      );

      expect(capturedAgentId).toBe("popup-agent");
    });

    it("forwards agentName to CopilotChat when agentId not set", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup agentName="legacy-popup" defaultOpen={true} />
        </CopilotKitProvider>,
      );

      expect(capturedAgentId).toBe("legacy-popup");
    });

    it("agentId takes priority over agentName", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup
            agentId="primary"
            agentName="legacy"
            defaultOpen={true}
          />
        </CopilotKitProvider>,
      );

      expect(capturedAgentId).toBe("primary");
    });

    it("uses default agent ID when neither provided", () => {
      render(
        <CopilotKitProvider runtimeUrl="https://api.test">
          <CopilotPopup defaultOpen={true} />
        </CopilotKitProvider>,
      );

      expect(capturedAgentId).toBe("default");
    });
  });

  it("renders children inside the popup", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup defaultOpen={true}>
          <span>Custom Content</span>
        </CopilotPopup>
      </CopilotKitProvider>,
    );

    expect(getByText("Custom Content")).toBeTruthy();
  });

  it("displays custom header title", () => {
    const { getByText } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup defaultOpen={true} headerTitle="My Chat" />
      </CopilotKitProvider>,
    );

    expect(getByText("My Chat")).toBeTruthy();
  });

  it("calls onOpen and onClose callbacks", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const ref = createRef<CopilotPopupHandle>();

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup ref={ref} onOpen={onOpen} onClose={onClose} />
      </CopilotKitProvider>,
    );

    act(() => {
      ref.current!.open();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => {
      ref.current!.close();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides FAB when showToggleButton=false", () => {
    const { queryByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup showToggleButton={false} defaultOpen={false} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-popup-fab")).toBeNull();
  });

  it("FAB toggles the popup open", () => {
    const { queryByTestId, getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup defaultOpen={false} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-popup-modal")).toBeNull();

    act(() => {
      fireEvent.click(getByTestId("copilot-popup-fab"));
    });

    expect(queryByTestId("copilot-popup-modal")).toBeTruthy();
  });

  it("close button in header closes the popup", () => {
    const { queryByTestId, getByTestId } = render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotPopup defaultOpen={true} />
      </CopilotKitProvider>,
    );

    expect(queryByTestId("copilot-popup-modal")).toBeTruthy();

    act(() => {
      fireEvent.click(getByTestId("copilot-popup-close"));
    });

    expect(queryByTestId("copilot-popup-modal")).toBeNull();
  });

  describe("attachments prop forwarding", () => {
    it("forwards attachments config to CopilotChat", () => {
      expect(() => {
        render(
          <CopilotKitProvider runtimeUrl="https://api.test">
            <CopilotPopup
              defaultOpen={true}
              attachments={{ enabled: true, accept: "image/*" }}
            />
          </CopilotKitProvider>,
        );
      }).not.toThrow();
    });
  });
});
