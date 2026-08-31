import React from "react";
import { render, renderHook, screen } from "@testing-library/react";
import type { AIMessage, Message } from "@copilotkit/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRenderToolCall } from "../../../v2";
import { useLazyToolRenderer } from "../use-lazy-tool-renderer";

vi.mock("../../../v2", () => ({
  useRenderToolCall: vi.fn(),
}));

const toolCalls = [
  {
    id: "weather-call",
    type: "function" as const,
    function: { name: "get_weather", arguments: "{}" },
  },
  {
    id: "time-call",
    type: "function" as const,
    function: { name: "get_time", arguments: "{}" },
  },
];

const message = {
  id: "assistant-message",
  role: "assistant",
  content: "",
  toolCalls,
} as AIMessage;

describe("useLazyToolRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every tool call and matches each tool result", () => {
    const renderToolCall = vi.fn(({ toolCall, toolMessage }) => (
      <div data-testid="tool-call">
        {toolCall.function.name}:{toolMessage?.content}
      </div>
    ));
    vi.mocked(useRenderToolCall).mockReturnValue(renderToolCall);

    const messages = [
      message,
      {
        id: "weather-result",
        role: "tool",
        toolCallId: "weather-call",
        content: "sunny",
      },
      {
        id: "time-result",
        role: "tool",
        toolCallId: "time-call",
        content: "noon",
      },
    ] as Message[];
    const { result } = renderHook(() => useLazyToolRenderer());

    const lazyRenderer = result.current(message, messages);
    expect(lazyRenderer).not.toBeNull();
    render(lazyRenderer!());

    expect(screen.getAllByTestId("tool-call")).toHaveLength(2);
    expect(screen.getByText("get_weather:sunny")).toBeTruthy();
    expect(screen.getByText("get_time:noon")).toBeTruthy();
    expect(renderToolCall).toHaveBeenCalledTimes(2);
  });

  it("returns null when none of the tool calls have a renderer", () => {
    vi.mocked(useRenderToolCall).mockReturnValue(vi.fn(() => null));
    const { result } = renderHook(() => useLazyToolRenderer());

    const lazyRenderer = result.current(message, []);

    expect(lazyRenderer).not.toBeNull();
    expect(lazyRenderer!()).toBeNull();
  });

  it("keeps rendered tool calls when another renderer returns null", () => {
    vi.mocked(useRenderToolCall).mockReturnValue(
      vi.fn(({ toolCall }) =>
        toolCall.id === "time-call" ? <div>time renderer</div> : null,
      ),
    );
    const { result } = renderHook(() => useLazyToolRenderer());

    const lazyRenderer = result.current(message, []);
    render(lazyRenderer!());

    expect(screen.getByText("time renderer")).toBeTruthy();
  });
});
