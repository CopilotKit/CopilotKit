import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useCopilotChatInternal } from "../use-copilot-chat_internal";
import { CoAgentStateRendersProvider, CopilotContext } from "../../context";
import { createTestCopilotContext } from "../../test-helpers/copilot-context";
import { useAgent, useCopilotKit, useCopilotChatConfiguration } from "../../v2";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

// ---------------------------------------------------------------------------
// Mutable state that tests can tweak between renders
// ---------------------------------------------------------------------------
let mockRuntimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus =
  CopilotKitCoreRuntimeConnectionStatus.Disconnected;
const mockConnectAgent = vi.fn().mockResolvedValue(undefined);

const mockAgent: Record<string, unknown> = {
  messages: [],
  state: {},
  isRunning: false,
  subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
  setMessages: vi.fn(),
  setState: vi.fn(),
  addMessage: vi.fn(),
  abortRun: vi.fn(),
  runAgent: vi.fn(),
  detachActiveRun: vi.fn().mockResolvedValue(undefined),
  threadId: undefined as string | undefined,
};

let mockConfigThreadId: string | undefined = "config-thread-id";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("../../v2", () => ({
  useAgent: vi.fn(() => ({ agent: mockAgent })),
  useCopilotKit: vi.fn(() => ({
    copilotkit: {
      connectAgent: mockConnectAgent,
      runtimeConnectionStatus: mockRuntimeConnectionStatus,
      getRunIdForMessage: vi.fn(),
      runAgent: vi.fn(),
      clearSuggestions: vi.fn(),
      addSuggestionsConfig: vi.fn(),
      reloadSuggestions: vi.fn(),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      interruptElement: null,
    },
  })),
  useCopilotChatConfiguration: vi.fn(() => ({
    agentId: "test-agent",
    threadId: mockConfigThreadId,
  })),
  useRenderCustomMessages: vi.fn(() => undefined),
  useSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
}));

vi.mock("../../components/toast/toast-provider", () => ({
  useToast: () => ({
    setBannerError: vi.fn(),
    addToast: vi.fn(),
  }),
}));

vi.mock("../../components/error-boundary/error-utils", () => ({
  useAsyncCallback: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("../use-langgraph-interrupt-render", () => ({
  useLangGraphInterruptRender: vi.fn(() => null),
}));

vi.mock("../use-lazy-tool-renderer", () => ({
  useLazyToolRenderer: vi.fn(() => () => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-apply the mock return values. Because `vi.mock` factory runs once at
 * module load, we need to update the mock implementations to pick up the
 * mutable variables that tests change.
 */
function applyMocks() {
  vi.mocked(useCopilotKit).mockReturnValue({
    copilotkit: {
      connectAgent: mockConnectAgent,
      runtimeConnectionStatus: mockRuntimeConnectionStatus,
      getRunIdForMessage: vi.fn(),
      runAgent: vi.fn(),
      clearSuggestions: vi.fn(),
      addSuggestionsConfig: vi.fn(),
      reloadSuggestions: vi.fn(),
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      interruptElement: null,
    },
  } as any);

  vi.mocked(useCopilotChatConfiguration).mockReturnValue({
    agentId: "test-agent",
    threadId: mockConfigThreadId,
  } as any);

  vi.mocked(useAgent).mockReturnValue({ agent: mockAgent } as any);
}

function createWrapper() {
  const copilotContextValue = createTestCopilotContext();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CopilotContext.Provider value={copilotContextValue}>
        <CoAgentStateRendersProvider>{children}</CoAgentStateRendersProvider>
      </CopilotContext.Provider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useCopilotChatInternal – connectAgent guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    mockConnectAgent.mockResolvedValue(undefined);
    mockAgent.threadId = undefined;
    mockAgent.messages = [];
    mockAgent.state = {};
    mockAgent.isRunning = false;
    mockConfigThreadId = "config-thread-id";
  });

  it("does not call connectAgent when status is Disconnected", () => {
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    applyMocks();

    renderHook(() => useCopilotChatInternal(), { wrapper: createWrapper() });

    expect(mockConnectAgent).not.toHaveBeenCalled();
  });

  it("does not call connectAgent when status is Connecting", () => {
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    applyMocks();

    renderHook(() => useCopilotChatInternal(), { wrapper: createWrapper() });

    expect(mockConnectAgent).not.toHaveBeenCalled();
  });

  it("calls connectAgent once when status transitions to Connected", async () => {
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    applyMocks();

    const { rerender } = renderHook(() => useCopilotChatInternal(), {
      wrapper: createWrapper(),
    });

    expect(mockConnectAgent).not.toHaveBeenCalled();

    // Transition to Connected
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    applyMocks();

    rerender();

    // Wait for the async connectAgent call
    await vi.waitFor(() => {
      expect(mockConnectAgent).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call connectAgent when threadId matches (same agent instance, no re-render)", async () => {
    // The wrapper guards via lastConnectedAgentRef: connect fires once per
    // agent instance, not once per render. After the first connect, further
    // re-renders with the same agent do not trigger another connect.
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockAgent.threadId = "config-thread-id";
    applyMocks();

    const { rerender } = renderHook(() => useCopilotChatInternal(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(mockConnectAgent).toHaveBeenCalledTimes(1);
    });

    // Re-render with same agent — should NOT connect again
    rerender();
    await vi.waitFor(() => {
      expect(mockConnectAgent).toHaveBeenCalledTimes(1);
    });
  });

  it("calls connectAgent when config threadId is missing", async () => {
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockConfigThreadId = undefined;
    applyMocks();

    renderHook(() => useCopilotChatInternal(), { wrapper: createWrapper() });

    await vi.waitFor(() => {
      expect(mockConnectAgent).toHaveBeenCalledTimes(1);
    });
  });

  it("calls connectAgent when status is Connected and threadIds differ", async () => {
    mockRuntimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockAgent.threadId = "old-thread-id"; // differs from config
    applyMocks();

    renderHook(() => useCopilotChatInternal(), { wrapper: createWrapper() });

    await vi.waitFor(() => {
      expect(mockConnectAgent).toHaveBeenCalledTimes(1);
      expect(mockConnectAgent).toHaveBeenCalledWith({ agent: mockAgent });
    });
  });

  it("passes resolved agentId to useAgent", () => {
    applyMocks();

    renderHook(() => useCopilotChatInternal(), { wrapper: createWrapper() });

    expect(vi.mocked(useAgent)).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "test-agent" }),
    );
  });
});
