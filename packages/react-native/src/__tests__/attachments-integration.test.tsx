// packages/react-native/src/__tests__/attachments-integration.test.tsx
import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetDocumentAsync = vi.fn();
const mockReadAsStringAsync = vi.fn();

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: any[]) => mockGetDocumentAsync(...args),
}));

vi.mock("expo-file-system", () => ({
  readAsStringAsync: (...args: any[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: "base64" },
}));

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
    runAgent: (...args: any[]) => mockRunAgent(...args),
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
import type { CopilotChatContextValue } from "../CopilotChat";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Attachments integration: full pick -> attach -> submit flow", () => {
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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pick a file, see it in attachments, submit message with attachment data", async () => {
    // Setup: DocumentPicker returns a JPEG file
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///cache/photo.jpg",
          name: "photo.jpg",
          size: 4096,
          mimeType: "image/jpeg",
        },
      ],
    });
    mockReadAsStringAsync.mockResolvedValue("aGVsbG8="); // base64 "hello"

    let chatCtx: CopilotChatContextValue | null = null;

    function Consumer() {
      chatCtx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="test-agent" attachments={{ enabled: true }}>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    // Verify initial state
    expect(chatCtx!.attachments).toEqual([]);
    expect(chatCtx!.attachmentsEnabled).toBe(true);

    // Step 1: Open picker
    await act(async () => {
      await chatCtx!.openPicker();
    });

    // Step 2: Verify attachment appeared
    expect(chatCtx!.attachments).toHaveLength(1);
    expect(chatCtx!.attachments[0]).toMatchObject({
      type: "image",
      filename: "photo.jpg",
      size: 4096,
      status: "ready",
      source: {
        type: "data",
        value: "aGVsbG8=",
        mimeType: "image/jpeg",
      },
    });

    // Step 3: Submit message with text + attachment
    await act(async () => {
      await chatCtx!.submitMessage("Check this photo");
    });

    // Step 4: Verify addMessage was called with InputContent array
    expect(mockAgent.addMessage).toHaveBeenCalledTimes(1);
    const call = mockAgent.addMessage.mock.calls[0][0];
    expect(call.role).toBe("user");
    expect(Array.isArray(call.content)).toBe(true);
    expect(call.content).toHaveLength(2);

    // Text part
    expect(call.content[0]).toMatchObject({
      type: "text",
      text: "Check this photo",
    });

    // Image part
    expect(call.content[1]).toMatchObject({
      type: "image",
      source: {
        type: "data",
        value: "aGVsbG8=",
        mimeType: "image/jpeg",
      },
      metadata: {
        filename: "photo.jpg",
      },
    });

    // Step 5: Verify attachments queue is now empty (consumed)
    expect(chatCtx!.attachments).toHaveLength(0);
  });

  it("submit without attachments sends plain text", async () => {
    let chatCtx: CopilotChatContextValue | null = null;

    function Consumer() {
      chatCtx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="test-agent" attachments={{ enabled: true }}>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    await act(async () => {
      await chatCtx!.submitMessage("Just text");
    });

    expect(mockAgent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "Just text",
      }),
    );
  });

  it("canceled picker does not add attachments", async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: true,
      assets: [],
    });

    let chatCtx: CopilotChatContextValue | null = null;

    function Consumer() {
      chatCtx = useCopilotChatContext();
      return null;
    }

    render(
      <CopilotKitProvider runtimeUrl="https://api.test">
        <CopilotChat agentId="test-agent" attachments={{ enabled: true }}>
          <Consumer />
        </CopilotChat>
      </CopilotKitProvider>,
    );

    await act(async () => {
      await chatCtx!.openPicker();
    });

    expect(chatCtx!.attachments).toHaveLength(0);
  });
});
