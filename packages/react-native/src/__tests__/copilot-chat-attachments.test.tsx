// packages/react-native/src/__tests__/copilot-chat-attachments.test.tsx
import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock expo modules (useAttachments imports these)
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));
vi.mock("expo-file-system", () => ({
  readAsStringAsync: vi.fn().mockResolvedValue("base64data"),
  EncodingType: { Base64: "base64" },
}));

// Mock react-native
vi.mock("react-native", () => {
  const _React = require("react");
  const View = ({ children, style, testID }: any) =>
    _React.createElement("div", { "data-testid": testID, style }, children);
  const Text = ({ children, style, testID }: any) =>
    _React.createElement("span", { "data-testid": testID, style }, children);
  const Pressable = ({ children, onPress, testID, style }: any) =>
    _React.createElement(
      "div",
      { "data-testid": testID, onClick: onPress, style },
      children,
    );
  return {
    View,
    Text,
    Pressable,
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { OS: "ios" },
  };
});

const hoisted = vi.hoisted(() => {
  const _React = require("react");
  return {
    RealContext: _React.createContext(null),
    MockCoreConstructor: vi.fn(),
  };
});

let mockAgent: any;
let unsubscribeMock: ReturnType<typeof vi.fn>;
let mockRunAgent: ReturnType<typeof vi.fn>;

function createMockCore() {
  return {
    subscribe: vi.fn((_sub: any) => ({ unsubscribe: unsubscribeMock })),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    setRuntimeUrl: vi.fn(),
    setRuntimeTransport: vi.fn(),
    setHeaders: vi.fn(),
    setCredentials: vi.fn(),
    setProperties: vi.fn(),
    setDebug: vi.fn(),
    setDefaultThrottleMs: vi.fn(),
    getAgent: vi.fn(() => undefined),
    runAgent: mockRunAgent,
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
    useAgent: () => {
      const ctx = require("react").useContext(hoisted.RealContext);
      if (!ctx) {
        throw new Error("useCopilotKit must be used within CopilotKitProvider");
      }
      return { agent: mockAgent };
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
      return { copilotkit: ctx };
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

import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChat, useCopilotChatContext } from "../CopilotChat";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotChat attachments integration", () => {
  beforeEach(() => {
    unsubscribeMock = vi.fn();
    mockRunAgent = vi.fn().mockResolvedValue(undefined);
    mockAgent = {
      addMessage: vi.fn(),
      isRunning: false,
      messages: [],
      threadId: undefined,
    };
    mockCoreInstance = createMockCore();
    hoisted.MockCoreConstructor.mockClear();
    hoisted.MockCoreConstructor.mockReturnValue(mockCoreInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes attachment state via useCopilotChatContext", () => {
    let ctx: any = null;

    function Consumer() {
      ctx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat attachments={{ enabled: true }}>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    expect(ctx).not.toBeNull();
    expect(ctx.attachments).toEqual([]);
    expect(typeof ctx.openPicker).toBe("function");
    expect(typeof ctx.removeAttachment).toBe("function");
    expect(typeof ctx.submitMessage).toBe("function");
    expect(ctx.attachmentsEnabled).toBe(true);
  });

  it("does not expose attachment functions when attachments not configured", () => {
    let ctx: any = null;

    function Consumer() {
      ctx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    expect(ctx.attachmentsEnabled).toBe(false);
  });

  it("submitMessage sends plain text when no attachments", async () => {
    let ctx: any = null;

    function Consumer() {
      ctx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat attachments={{ enabled: true }}>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    await act(async () => {
      await ctx.submitMessage("Hello world");
    });

    expect(mockAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Hello world",
      }),
    );
  });
});
