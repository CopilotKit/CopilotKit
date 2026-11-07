import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import {
  CopilotChatToolCallsView,
  WildcardToolCallRender,
} from "@copilotkit/react-core/v2";
import type { AssistantMessage, Message } from "@copilotkit/react-core/v2";
import { toolCall, toolResult } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";

/**
 * `WildcardToolCallRender` is a ready-made `name: "*"` renderer: register it in
 * `renderToolCalls` and every tool without its own renderer gets a card. These
 * stories register it on the provider and render calls through
 * `CopilotChatToolCallsView`.
 */
type WildcardStoryArgs = { message: AssistantMessage; messages: Message[] };

const weather = toolCall("weather", "getWeather", {
  location: "San Francisco",
  units: "fahrenheit",
});

const assistant = (
  toolCalls: NonNullable<AssistantMessage["toolCalls"]>,
): AssistantMessage => ({
  id: "assistant-wildcard",
  role: "assistant",
  content: "",
  toolCalls,
});

const expand = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const header = await within(canvasElement).findByText(
    /getWeather|createIssue/,
  );
  await userEvent.click(header);
};

const meta = {
  title: "UI/WildcardToolCallRender",
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
    copilotkit: { provider: { renderToolCalls: [WildcardToolCallRender] } },
  },
  args: {
    message: assistant([weather]),
    messages: [],
  },
  render: (args) => <CopilotChatToolCallsView {...args} />,
} satisfies Meta<WildcardStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};

export const Complete: Story = {
  args: {
    messages: [
      toolResult(
        "weather",
        JSON.stringify({ temperature: 68, conditions: "Partly cloudy" }),
      ),
    ],
  },
};

/** Expanded to show the arguments and the result. */
export const Expanded: Story = {
  args: Complete.args,
  play: expand,
};

/**
 * A failed call. There is no error status: the failure arrives as a completed
 * call whose result carries the error.
 */
export const ErrorResult: Story = {
  args: {
    message: assistant([
      toolCall("issue", "createIssue", {
        title: "Checkout button unresponsive",
      }),
    ]),
    messages: [
      toolResult(
        "issue",
        JSON.stringify({ error: "403: token lacks repo scope" }),
      ),
    ],
  },
  play: expand,
};
