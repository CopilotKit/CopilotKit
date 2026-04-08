import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotChat } from "../CopilotChat";
import { useAgent } from "../../../hooks/use-agent";
import { useCopilotKit } from "../../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../../providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

// Mock useAgent to inspect the props it receives
vi.mock("../../../hooks/use-agent", () => ({
  useAgent: vi.fn(() => ({
    agent: new MockStepwiseAgent(),
  })),
}));

vi.mock("../../../providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
  useLicenseContext: vi.fn(() => ({
    checkFeature: () => true,
  })),
}));

vi.mock(
  "../../../providers/CopilotChatConfigurationProvider",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../providers/CopilotChatConfigurationProvider")
      >();
    return {
      ...actual,
      useCopilotChatConfiguration: vi.fn(() => undefined),
      CopilotChatConfigurationProvider: ({
        children,
      }: {
        children: React.ReactNode;
      }) => <>{children}</>,
    };
  },
);

// Mock suggestions hook
vi.mock("../../../hooks/use-suggestions", () => ({
  useSuggestions: vi.fn(() => ({ suggestions: [] })),
}));

// Mock attachments hook
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

describe("CopilotChat throttleMs prop", () => {
  let mockAgent: MockStepwiseAgent;

  beforeEach(() => {
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "default";

    mockUseAgent.mockReturnValue({ agent: mockAgent });

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        getAgent: () => mockAgent,
        runtimeUrl: "http://localhost:3000/api/copilot",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        runtimeTransport: "rest",
        headers: {},
        agents: { default: mockAgent },
        connectAgent: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
        audioFileTranscriptionEnabled: false,
      },
      executingToolCallIds: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes throttleMs prop to useAgent", () => {
    render(<CopilotChat throttleMs={500} />);

    expect(mockUseAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: 500,
      }),
    );
  });

  it("passes undefined throttleMs when prop is not set", () => {
    render(<CopilotChat />);

    expect(mockUseAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: undefined,
      }),
    );
  });
});
