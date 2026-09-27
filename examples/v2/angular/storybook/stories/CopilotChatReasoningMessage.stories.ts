import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import type { Message, ReasoningMessage } from "@ag-ui/client";
import { CopilotChatReasoningMessage } from "@copilotkit/angular";
import { withMessageColumn } from "./support/layouts";

const reasoning = (content: string): ReasoningMessage => ({
  id: "reasoning-1",
  role: "reasoning",
  content,
});

const fullReasoning = `The user wants to **compare two pricing tiers**.

- Starter covers up to 3 seats; Team adds SSO and audit logs.
- They mentioned 12 people, so Starter is out.
- I'll recommend Team and call out the annual discount.`;

/**
 * The collapsible "Thinking…" block for streamed model reasoning. It opens
 * while the agent is reasoning and collapses to "Thought for …" once done.
 */
/** Runs the real component with `isRunning` flipping off after 1.5s. */
@Component({
  selector: "story-stream-then-collapse",
  imports: [CopilotChatReasoningMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <copilot-chat-reasoning-message
      [message]="message()"
      [messages]="messages()"
      [isRunning]="running()"
    />
  `,
})
class StoryStreamThenCollapse {
  readonly message = input.required<ReasoningMessage>();
  readonly messages = input<Message[]>([]);
  protected readonly running = signal(true);

  constructor() {
    setTimeout(() => this.running.set(false), 1500);
  }
}

const meta: Meta<CopilotChatReasoningMessage> = {
  title: "UI/CopilotChatReasoningMessage",
  component: CopilotChatReasoningMessage,
  decorators: [
    moduleMetadata({ imports: [CopilotChatReasoningMessage] }),
    withMessageColumn,
  ],
  render: (args) => ({
    props: {
      ...args,
      // The block streams only while it is the latest message in the run.
      messages: [args.message] as Message[],
    },
    template: `
      <copilot-chat-reasoning-message
        [message]="message"
        [messages]="messages"
        [isRunning]="isRunning"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatReasoningMessage>;

/** Reasoning has started but no text has arrived yet. */
export const ThinkingWithoutContent: Story = {
  args: { message: reasoning(""), isRunning: true },
};

/** Reasoning text streaming in, expanded with a live cursor. */
export const Streaming: Story = {
  args: {
    message: reasoning(fullReasoning.slice(0, 120)),
    isRunning: true,
  },
};

/** Finished: collapsed to a summary line. Click it to expand. */
export const Finished: Story = {
  args: { message: reasoning(fullReasoning), isRunning: false },
};

const longReasoning = `Let me break this request down before answering.

1. **Scope** — the user is asking for a migration plan from REST polling to server-sent events, with an Angular frontend and an Express backend.
2. **Constraints** — the old endpoint has to stay alive for mobile clients during the transition, which rules out a hard cut-over.
3. **Approach** — add an \`/events\` endpoint that streams the same payloads, feature-flag the frontend, and only then deprecate polling.

A few risks worth calling out:

- Proxies that buffer responses will break streaming unless \`X-Accel-Buffering: no\` is set.
- Reconnects need \`Last-Event-ID\` handling, otherwise clients will miss events.
- Load balancers with short idle timeouts drop long-lived connections; a heartbeat every 15s avoids that.`;

/** A long, finished reasoning block expanded by the user. */
export const ExpandedLongReasoning: Story = {
  args: { message: reasoning(longReasoning), isRunning: false },
  play: async ({ canvasElement }) => {
    const toggle = await new Promise<HTMLButtonElement>((resolve) => {
      const find = () => {
        const el = canvasElement.querySelector<HTMLButtonElement>(
          '[data-testid="reasoning-block"]',
        );
        if (el) resolve(el);
        else requestAnimationFrame(find);
      };
      find();
    });
    toggle.click();
  },
};

/**
 * Streams for a moment, then the run finishes and the block collapses to
 * "Thought for …". Re-render the story to replay.
 */
export const StreamThenCollapse: Story = {
  args: { message: reasoning(fullReasoning), isRunning: true },
  render: (args) => ({
    props: { ...args, messages: [args.message] as Message[] },
    template: `
      <story-stream-then-collapse [message]="message" [messages]="messages" />
    `,
  }),
  decorators: [moduleMetadata({ imports: [StoryStreamThenCollapse] })],
};
