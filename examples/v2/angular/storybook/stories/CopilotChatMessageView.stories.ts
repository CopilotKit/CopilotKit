import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import type { Message } from "@ag-ui/client";
import { CopilotChatMessageView } from "@copilotkit/angular";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { multiStepReply, toolCallConversation } from "./support/fixtures";
import { withMessageColumn } from "./support/layouts";
import { storyToolRenderers } from "./support/tool-renderers";

const conversation: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "Hello! Can you help me understand how Angular signals work?",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: `Signals are reactive values that notify Angular when they change. The core primitives are:

- **signal()** — a writable value
- **computed()** — a value derived from other signals
- **effect()** — runs side effects when signals change
- **linkedSignal()** — writable state that resets from a source

Would you like an example?`,
  },
  {
    id: "user-2",
    role: "user",
    content: "Yes, a simple counter please.",
  },
  {
    id: "assistant-2",
    role: "assistant",
    content: `Here's a counter component:

\`\`\`ts
import { Component, computed, signal } from '@angular/core';

@Component({
  selector: 'app-counter',
  template: \`<button (click)="increment()">{{ count() }} × 2 = {{ double() }}</button>\`,
})
export class Counter {
  readonly count = signal(0);
  readonly double = computed(() => this.count() * 2);

  increment() {
    this.count.update((n) => n + 1);
  }
}
\`\`\`

- \`signal(0)\` creates the state
- \`computed()\` re-derives \`double\` whenever \`count\` changes
- \`update()\` sets the next value from the previous one`,
  },
];

const meta: Meta<CopilotChatMessageView> = {
  title: "UI/CopilotChatMessageView",
  component: CopilotChatMessageView,
  decorators: [
    moduleMetadata({ imports: [CopilotChatMessageView] }),
    withMessageColumn,
  ],
  args: {
    messages: conversation,
    showCursor: false,
    assistantMessageToolbarScope: "turn",
  },
  argTypes: {
    assistantMessageToolbarScope: {
      control: "inline-radio",
      options: ["turn", "message"],
    },
  },
  render: (args) => ({
    props: args,
    template: `
      <copilot-chat-message-view
        [messages]="messages"
        [showCursor]="showCursor"
        [assistantMessageToolbarScope]="assistantMessageToolbarScope"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatMessageView>;

export const Default: Story = {};

/** The pulsing cursor shown while the agent is about to respond. */
export const ShowCursor: Story = {
  args: {
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "Can you explain how AI models work?",
      },
    ],
    showCursor: true,
  },
};

/** Tool calls rendered by app-registered renderers (`renderToolCalls`). */
export const WithToolCalls: Story = {
  args: { messages: toolCallConversation },
  parameters: {
    copilotkit: {
      config: { renderToolCalls: storyToolRenderers },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Tool calls with CopilotKit's built-in renderer (`defaultToolRendering`). */
export const DefaultToolRenderer: Story = {
  args: { messages: toolCallConversation },
  parameters: {
    copilotkit: {
      config: { defaultToolRendering: true },
    } satisfies CopilotKitStoryParameters,
  },
};

/**
 * One user message answered in several steps (text, a tool call, more text)
 * reads as one reply: a single toolbar under the last message, and copy covers
 * the whole reply.
 */
export const MultiStepReply: Story = {
  args: { messages: multiStepReply },
  parameters: {
    copilotkit: {
      config: { defaultToolRendering: true },
    } satisfies CopilotKitStoryParameters,
  },
};

/** `assistantMessageToolbarScope="message"`: a toolbar under every assistant message with text. */
export const ToolbarPerMessage: Story = {
  args: { messages: multiStepReply, assistantMessageToolbarScope: "message" },
  parameters: MultiStepReply.parameters,
};
