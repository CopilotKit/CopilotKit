import React, { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CopilotChatReasoningMessage } from "@copilotkit/react-core/v2";
import type { ReasoningMessage } from "@copilotkit/react-core/v2";
import { longReasoning, shortReasoning } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";

const reasoning = (content: string): ReasoningMessage => ({
  id: "reasoning-story",
  role: "reasoning",
  content,
});

/**
 * Reasoning ("thinking") output. It is open while the reasoning message is the
 * latest one in a running turn, then collapses to "Thought for …" when the run
 * moves on; the header toggles it.
 */
const meta = {
  title: "UI/CopilotChatReasoningMessage",
  component: CopilotChatReasoningMessage,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    message: reasoning(shortReasoning),
  },
} satisfies Meta<typeof CopilotChatReasoningMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Reasoning is streaming: open, with the pulsing cursor after the text. */
export const Streaming: Story = {
  render: (args) => {
    const message = reasoning(shortReasoning.split(" ").slice(0, 14).join(" "));
    return (
      <CopilotChatReasoningMessage
        {...args}
        message={message}
        messages={[message]}
        isRunning
      />
    );
  },
};

/** The run started but no reasoning text has arrived yet. */
export const ThinkingWithoutContent: Story = {
  render: (args) => {
    const message = reasoning("");
    return (
      <CopilotChatReasoningMessage
        {...args}
        message={message}
        messages={[message]}
        isRunning
      />
    );
  },
};

/** Finished: collapsed to its summary line. */
export const Finished: Story = {};

/** A long, finished reasoning block expanded by clicking the header. */
export const ExpandedLongReasoning: Story = {
  args: {
    message: reasoning(longReasoning),
  },
  play: async ({ canvasElement }) => {
    const header = within(canvasElement).getByRole("button", {
      name: /thought for/i,
    });
    await userEvent.click(header);
    await expect(header).toHaveAttribute("aria-expanded", "true");
    // Drop the programmatic focus ring so the resting expanded state shows.
    header.blur();
  },
};

/** Streams word by word, then collapses when the turn ends. Replays on click. */
export const StreamThenCollapse: Story = {
  render: (args) => {
    const words = longReasoning.split(" ");
    const [run, setRun] = useState(0);
    const [count, setCount] = useState(0);
    const streaming = count < words.length;

    useEffect(() => {
      setCount(0);
      const timer = setInterval(
        () => setCount((n) => Math.min(n + 2, words.length)),
        40,
      );
      return () => clearInterval(timer);
    }, [run, words.length]);

    const message = reasoning(words.slice(0, count).join(" "));
    return (
      <div className="space-y-4">
        <CopilotChatReasoningMessage
          {...args}
          message={message}
          messages={[message]}
          isRunning={streaming}
        />
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Replay
        </button>
      </div>
    );
  },
};
