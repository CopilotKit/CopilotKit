import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { CopilotChatToolCallsView } from "@copilotkit/react-core/v2";
import type { AssistantMessage, Message } from "@copilotkit/react-core/v2";
import { toolCall, toolResult } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { withDefaultToolRenderer } from "./support/providers";
import { demoToolRenderers } from "./support/ToolCards";

/**
 * Renders the tool calls of one assistant message through the renderers
 * registered on the provider, pairing each call with its tool result from
 * `messages`. A call without a result renders as in progress.
 */
const assistant = (
  toolCalls: NonNullable<AssistantMessage["toolCalls"]>,
): AssistantMessage => ({
  id: "assistant-tool-calls",
  role: "assistant",
  content: "",
  toolCalls,
});

const releaseNotes = toolCall("release-notes", "searchReleaseNotes", {
  query: "CopilotKit release notes",
  includePrereleases: false,
});
const deploy = toolCall("deploy", "deployPreview", {
  project: "acme-web",
  branch: "feature/checkout",
});

const meta = {
  title: "UI/CopilotChatToolCallsView",
  component: CopilotChatToolCallsView,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    message: assistant([releaseNotes]),
    messages: [] as Message[],
  },
} satisfies Meta<typeof CopilotChatToolCallsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Built-in default card (`useDefaultRenderTool()`), call still running. */
export const InProgress: Story = {
  decorators: [withDefaultToolRenderer],
};

/** Built-in default card with its result. */
export const Complete: Story = {
  args: {
    messages: [
      toolResult(
        "release-notes",
        "Found release notes for @copilotkit/react-core 1.60 and the runtime packages.",
      ),
    ],
  },
  decorators: [withDefaultToolRenderer],
};

/** The default card expanded to show arguments and result. */
export const Expanded: Story = {
  args: Complete.args,
  decorators: [withDefaultToolRenderer],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { expanded: false }),
    );
  },
};

/**
 * A failed call. Tool renderers have no error status: a failure arrives as a
 * completed call whose result describes the error.
 */
export const ErrorResult: Story = {
  args: {
    message: assistant([deploy]),
    messages: [
      toolResult(
        "deploy",
        JSON.stringify({ error: "Build failed: missing env var STRIPE_KEY" }),
      ),
    ],
  },
  decorators: [withDefaultToolRenderer],
  play: Expanded.play,
};

/** App-defined renderers registered via `renderToolCalls`, in both states. */
export const CustomRenderer: Story = {
  args: {
    message: assistant([
      toolCall("search", "search", {
        query: "pricing experiments",
        filters: ["2026", "growth"],
      }),
      toolCall("calc", "calculator", { expression: "1280 * 0.18" }),
    ]),
    messages: [toolResult("search", "Found 3 experiment write-ups.")],
  },
  parameters: {
    copilotkit: { provider: { renderToolCalls: demoToolRenderers } },
  },
};
