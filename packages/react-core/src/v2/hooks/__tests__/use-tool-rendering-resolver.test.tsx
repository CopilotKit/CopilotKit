import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall, ToolMessage } from "@ag-ui/core";
import { ToolCallStatus } from "@copilotkit/core";
import { useRenderToolCall, useToolRenderingResolver } from "../../index";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import type { ReactToolCallRenderer } from "../../types/react-tool-call-renderer";

vi.mock("../../providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseCopilotChatConfiguration =
  useCopilotChatConfiguration as ReturnType<typeof vi.fn>;

function makeToolCall(name = "get_weather"): ToolCall {
  return {
    id: "tool-call-1",
    type: "function",
    function: {
      name,
      arguments: JSON.stringify({ location: "Lisbon" }),
    },
  } as ToolCall;
}

function makeToolMessage(): ToolMessage {
  return {
    id: "tool-message-1",
    role: "tool",
    toolCallId: "tool-call-1",
    content: "Sunny",
  } as ToolMessage;
}

function createRenderer(name = "get_weather"): ReactToolCallRenderer {
  return {
    name,
    args: {} as ReactToolCallRenderer["args"],
    render: ({ args, status, result }) => (
      <div data-testid="tool-render">
        {String((args as { location?: string }).location)}:{status}:{result}
      </div>
    ),
  };
}

function configureCopilotKit({
  renderToolCalls = [createRenderer()],
  executingToolCallIds = new Set<string>(),
}: {
  renderToolCalls?: ReactToolCallRenderer[];
  executingToolCallIds?: Set<string>;
} = {}) {
  mockUseCopilotKit.mockReturnValue({
    executingToolCallIds,
    copilotkit: {
      renderToolCalls,
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
  });
  mockUseCopilotChatConfiguration.mockReturnValue(undefined);
}

function ResolvedToolCall({
  deprecated = false,
  toolMessage,
}: {
  deprecated?: boolean;
  toolMessage?: ToolMessage;
}) {
  const resolver = deprecated
    ? useRenderToolCall()
    : useToolRenderingResolver();

  return resolver({
    toolCall: makeToolCall(),
    toolMessage,
  });
}

describe("useToolRenderingResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCopilotKit();
  });

  it("returns CopilotKit's low-level resolver for registered tool renderers", () => {
    render(<ResolvedToolCall />);

    expect(screen.getByTestId("tool-render").textContent).toBe(
      "Lisbon:inProgress:",
    );
  });

  it("passes completed tool results to the matched renderer", () => {
    render(<ResolvedToolCall toolMessage={makeToolMessage()} />);

    expect(screen.getByTestId("tool-render").textContent).toBe(
      "Lisbon:complete:Sunny",
    );
  });

  it("keeps useRenderToolCall as a deprecated alias with a once-per-mount warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ui = render(<ResolvedToolCall deprecated />);
    ui.rerender(<ResolvedToolCall deprecated />);

    expect(screen.getByTestId("tool-render")).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("useRenderToolCall");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("useToolRenderingResolver");

    warnSpy.mockRestore();
  });
});
