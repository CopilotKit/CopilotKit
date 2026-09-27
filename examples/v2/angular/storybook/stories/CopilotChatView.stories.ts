import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import {
  ChatState,
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { StoryChatState } from "./support/story-chat-state";
import type { Suggestion } from "@copilotkit/angular";
import {
  manySuggestions,
  starterSuggestions,
  storySuggestions,
} from "./support/fixtures";
import type { Message } from "@ag-ui/client";

const meta: Meta<CopilotChatView> = {
  title: "UI/CopilotChatView",
  component: CopilotChatView,
  decorators: [
    moduleMetadata({
      imports: [
        CommonModule,
        CopilotChatView,
        CopilotChatMessageView,
        CopilotChatInput,
      ],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
          chatDisclaimerText:
            "AI can make mistakes. Please verify important information.",
        }),
        { provide: ChatState, useClass: StoryChatState },
      ],
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<CopilotChatView>;

// Default story
const integrationConversation: Message[] = ([] = [
  {
    id: "user-1",
    content: "Hello! How can I integrate CopilotKit with my Angular app?",
    role: "user" as const,
  },
  {
    id: "assistant-1",
    content: `To integrate CopilotKit with your Angular app, follow these steps:

1. Install the package:
\`\`\`bash
npm install @copilotkit/angular
\`\`\`

2. Import and configure in your component:
\`\`\`typescript
import { provideCopilotKit } from '@copilotkit/angular';

@Component({
  providers: [provideCopilotKit({})]
})
\`\`\`

3. Use the chat components in your template!`,
    role: "assistant" as const,
  },
  {
    id: "user-2",
    content: "That looks great! Can I customize the appearance?",
    role: "user" as const,
  },
  {
    id: "assistant-2",
    content:
      "Yes! CopilotKit is highly customizable. You can customize the appearance using Tailwind CSS classes or by providing your own custom components through the slot system.",
    role: "assistant" as const,
  },
]);

export const Default: Story = {
  render: () => {
    const messages = integrationConversation;

    const onThumbsUp = (event: any) => {
      console.info("Thumbs up! You liked this message.");
      console.log("Thumbs up event:", event);
    };

    const onThumbsDown = (event: any) => {
      console.info("Thumbs down! You disliked this message.");
      console.log("Thumbs down event:", event);
    };

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            (assistantMessageThumbsUp)="onThumbsUp($event)"
            (assistantMessageThumbsDown)="onThumbsDown($event)">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        onThumbsUp,
        onThumbsDown,
      },
    };
  },
};

// Story with manual scroll
export const ManualScroll: Story = {
  render: () => {
    // Generate many messages to show scroll behavior
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        messages.push({
          id: `user-${i}`,
          content: `User message ${i}: This is a test message to demonstrate scrolling behavior.`,
          role: "user" as const,
        });
      } else {
        messages.push({
          id: `assistant-${i}`,
          content: `Assistant response ${i}: This is a longer response to demonstrate how the chat interface handles various message lengths and scrolling behavior when there are many messages in the conversation.`,
          role: "assistant" as const,
        });
      }
    }

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [autoScroll]="false">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
      },
    };
  },
};

// Story with empty state
export const EmptyState: Story = {
  render: () => {
    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="[]">
          </copilot-chat-view>
        </div>
      `,
      props: {},
    };
  },
};

/** Provides a StoryChatState whose suggestions are `suggestions`. */
const withSuggestionState = (suggestions: Suggestion[]) =>
  moduleMetadata({
    providers: [
      {
        provide: ChatState,
        useFactory: () => {
          const state = new StoryChatState();
          state.suggestions.set(suggestions);
          return state;
        },
      },
    ],
  });

const fullHeightView = (inputs = "") => `
  <div style="height: 100vh; overflow: hidden">
    <copilot-chat-view [messages]="messages" ${inputs} />
  </div>
`;

/**
 * No messages yet: the greeting, suggestion cards (title as header, message as
 * body) and the input, centered together and easing in.
 */
export const WelcomeScreen: Story = {
  decorators: [withSuggestionState(starterSuggestions)],
  render: () => ({ props: { messages: [] }, template: fullHeightView() }),
};

/** The welcome screen with `introAnimation` off: content appears immediately. */
export const WithoutIntroAnimation: Story = {
  decorators: [withSuggestionState(starterSuggestions)],
  render: () => ({
    props: { messages: [] },
    template: fullHeightView(`[introAnimation]="false"`),
  }),
};

/**
 * In a conversation, suggestions sit in one row docked above the input. The
 * last one is still loading, to show the pill's loading state.
 */
export const WithSuggestions: Story = {
  decorators: [
    withSuggestionState(
      storySuggestions.map((s, i) => (i === 2 ? { ...s, isLoading: true } : s)),
    ),
  ],
  render: () => ({
    props: { messages: integrationConversation },
    template: fullHeightView(),
  }),
};

/**
 * More suggestions than fit: the docked bar above the input scrolls
 * horizontally, and its right edge fades to show there is more.
 */
export const WithManySuggestions: Story = {
  decorators: [withSuggestionState(manySuggestions)],
  render: () => ({
    props: { messages: integrationConversation },
    template: fullHeightView(),
  }),
};

/** A run in flight: typing cursor in the transcript, toolbar and suggestions hidden. */
export const Running: Story = {
  render: () => ({
    props: {
      messages: [
        ...integrationConversation,
        {
          id: "user-3",
          role: "user",
          content: "And how do I persist the chat across reloads?",
        },
      ] satisfies Message[],
    },
    template: fullHeightView(`[isRunning]="true" [showCursor]="true"`),
  }),
};
