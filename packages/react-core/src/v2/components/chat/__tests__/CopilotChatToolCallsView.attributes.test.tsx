import React from "react";
import { screen } from "@testing-library/react";
import { z } from "zod";
import type { AssistantMessage } from "@ag-ui/core";
import { defineToolCallRenderer } from "../../../types";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";

const weatherRenderer = defineToolCallRenderer({
  name: "getWeather",
  args: z.object({ city: z.string() }),
  render: ({ args }) => (
    <button type="button" data-testid="tool-ui">
      {args.city}
    </button>
  ),
});

function createAssistantMessage(): AssistantMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Checking the weather.",
    toolCalls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "getWeather", arguments: '{"city":"Berlin"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "getWeather", arguments: '{"city":"Paris"}' },
      },
    ],
  };
}

function renderMessage(
  children?: React.ComponentProps<
    typeof CopilotChatAssistantMessage
  >["children"],
) {
  renderWithCopilotKit({
    renderToolCalls: [weatherRenderer],
    children: (
      <CopilotChatAssistantMessage message={createAssistantMessage()}>
        {children}
      </CopilotChatAssistantMessage>
    ),
  });
}

function toolCallIdsOf(button: HTMLElement) {
  const wrapper = button.closest("[data-tool-call-id]");
  const message = button.closest("[data-message-id]");
  return {
    toolCallId: wrapper?.getAttribute("data-tool-call-id"),
    messageId: message?.getAttribute("data-message-id"),
  };
}

describe("tool call DOM attributes", () => {
  it("marks each rendered tool call with its id inside the message", async () => {
    renderMessage();

    const buttons = await screen.findAllByTestId("tool-ui");

    expect(buttons.map(toolCallIdsOf)).toEqual([
      { toolCallId: "call-1", messageId: "msg-1" },
      { toolCallId: "call-2", messageId: "msg-1" },
    ]);
  });

  it("keeps the message id on a custom children layout", async () => {
    renderMessage(({ toolCallsView }) => <section>{toolCallsView}</section>);

    const buttons = await screen.findAllByTestId("tool-ui");

    expect(toolCallIdsOf(buttons[0]!)).toEqual({
      toolCallId: "call-1",
      messageId: "msg-1",
    });
  });
});
