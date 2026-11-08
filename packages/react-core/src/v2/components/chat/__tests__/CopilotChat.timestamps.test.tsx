import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSubscriber, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { CopilotChat } from "../CopilotChat";
import type { CopilotPopupProps } from "../CopilotPopup";
import type { CopilotSidebarProps } from "../CopilotSidebar";
import { useAgent } from "../../../hooks/use-agent";
import { useCopilotKit } from "../../../context";
import { useCopilotChatConfiguration } from "../../../providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { readMessageTimestamp } from "../../../lib/message-timestamp";

vi.mock("../../../hooks/use-agent", () => ({
  useAgent: vi.fn(),
}));

vi.mock("../../../context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context")>();
  return {
    ...actual,
    useCopilotKit: vi.fn(),
    useDefaultAgentId: vi.fn(() => undefined),
    useLicenseContext: vi.fn(() => ({
      checkFeature: () => true,
    })),
  };
});

vi.mock("../../../hooks/use-suggestions", () => ({
  useSuggestions: vi.fn(() => ({ suggestions: [] })),
}));

vi.mock("../../../hooks/use-attachments", () => ({
  useAttachments: vi.fn(() => ({
    attachments: [],
    enabled: false,
    dragOver: false,
    fileInputRef: { current: null },
    containerRef: { current: null },
    handleFileUpload: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    removeAttachment: vi.fn(),
    consumeAttachments: vi.fn(() => []),
  })),
}));

const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;
const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

function SubmitProbe(props: { onSubmitMessage?: (value: string) => void }) {
  const config = useCopilotChatConfiguration();
  return (
    <div>
      <div data-testid="show-timestamps">
        {String(config?.showTimestamps ?? false)}
      </div>
      <div data-testid="formatted-time">
        {config?.formatTimestamp?.(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))) ??
          ""}
      </div>
      <button type="button" onClick={() => props.onSubmitMessage?.("Hello")}>
        send
      </button>
    </div>
  );
}

describe("CopilotChat timestamps", () => {
  let mockAgent: MockStepwiseAgent;
  let subscribers: AgentSubscriber[];

  beforeEach(() => {
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "default";
    subscribers = [];
    const subscribe = mockAgent.subscribe.bind(mockAgent);
    mockAgent.subscribe = (subscriber) => {
      subscribers.push(subscriber);
      return subscribe(subscriber);
    };

    mockUseAgent.mockReturnValue({ agent: mockAgent, isReady: true });
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        getAgent: () => mockAgent,
        runtimeUrl: "http://localhost:3000/api/copilot",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        runtimeTransport: "rest",
        headers: {},
        agents: { [String(mockAgent.agentId)]: mockAgent },
        connectAgent: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
        runAgent: vi.fn().mockResolvedValue(undefined),
        audioFileTranscriptionEnabled: false,
      },
      executingToolCallIds: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function timestampSubscriber() {
    return subscribers.find((subscriber) => subscriber.onTextMessageStartEvent);
  }

  it("passes showTimestamps and formatTimestamp into chat configuration", () => {
    render(
      <CopilotChat
        showTimestamps
        formatTimestamp={() => "2:05 PM"}
        chatView={SubmitProbe}
      />,
    );

    expect(screen.getByTestId("show-timestamps").textContent).toBe("true");
    expect(screen.getByTestId("formatted-time").textContent).toBe("2:05 PM");
  });

  it("leaves timestamps off when the prop is omitted", () => {
    render(<CopilotChat chatView={SubmitProbe} />);
    expect(screen.getByTestId("show-timestamps").textContent).toBe("false");
  });

  it("records a timestamp when the user sends a message", async () => {
    render(<CopilotChat showTimestamps chatView={SubmitProbe} />);
    const before = Date.now();

    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(mockAgent.messages).toHaveLength(1);
    });
    const stamped = readMessageTimestamp(mockAgent.messages[0]);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
    expect(mockAgent.messages[0]).toMatchObject({
      role: "user",
      content: "Hello",
    });
  });

  it("stamps an assistant message from TEXT_MESSAGE_START", () => {
    render(<CopilotChat showTimestamps chatView={SubmitProbe} />);
    const subscriber = timestampSubscriber();
    expect(subscriber).toBeDefined();

    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "",
    };
    subscriber?.onTextMessageStartEvent?.({
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "assistant-1",
        timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
      },
      messages: [],
      state: {},
      agent: mockAgent,
      input: {} as RunAgentInput,
    });
    subscriber?.onMessagesChanged?.({
      messages: [message],
      state: {},
      agent: mockAgent,
    });

    expect(readMessageTimestamp(message)).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
  });

  it("does not stamp restored assistant messages", () => {
    render(<CopilotChat showTimestamps chatView={SubmitProbe} />);
    const subscriber = timestampSubscriber();
    const restored = {
      id: "old-assistant",
      role: "assistant" as const,
      content: "Earlier reply",
    };

    subscriber?.onMessagesChanged?.({
      messages: [restored],
      state: {},
      agent: mockAgent,
    });

    expect(readMessageTimestamp(restored)).toBeUndefined();
  });
});

describe("timestamp prop inheritance", () => {
  it("CopilotPopupProps includes showTimestamps", () => {
    const props: CopilotPopupProps = { showTimestamps: true };
    expect(props.showTimestamps).toBe(true);
  });

  it("CopilotSidebarProps includes showTimestamps", () => {
    const props: CopilotSidebarProps = {
      showTimestamps: true,
      formatTimestamp: () => "now",
    };
    expect(props.formatTimestamp?.(new Date())).toBe("now");
  });
});
