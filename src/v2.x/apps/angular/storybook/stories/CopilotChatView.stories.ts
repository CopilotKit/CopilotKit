import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotChatLabels,
  provideCopilotKit,
} from "@copilotkitnext/angular";
import { Message } from "@ag-ui/client";

const meta: Meta<CopilotChatView> = {
  title: "UI/CopilotChatView/Basic Examples",
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
        provideCopilotKit({}),
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
          chatDisclaimerText:
            "AI can make mistakes. Please verify important information.",
        }),
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
export const Default: Story = {
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    CopilotChatView,
    CopilotChatMessageView,
    CopilotChatInput
  ],
  providers: [
    provideCopilotKit({}),
      provideCopilotChatLabels({
      chatInputPlaceholder: 'Type a message...',
      chatDisclaimerText: 'AI can make mistakes. Please verify important information.'
    }),
  ],
  template: \`
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
      <copilot-chat-view
        [messages]="messages"
        (assistantMessageThumbsUp)="onThumbsUp($event)"
        (assistantMessageThumbsDown)="onThumbsDown($event)">
      </copilot-chat-view>
    </div>
  \`
})
export class ChatComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Hello! How can I integrate CopilotKit with my Angular app?',
      role: 'user'
    },
    {
      id: 'assistant-1',
      content: \`To integrate CopilotKit with your Angular app, follow these steps:

1. Install the package:
\\\`\\\`\\\`bash
npm install @copilotkitnext/angular
\\\`\\\`\\\`

2. Import and configure in your component:
\\\`\\\`\\\`typescript
import { provideCopilotKit } from '@copilotkitnext/angular';

@Component({
  providers: [provideCopilotKit({})]
})
\\\`\\\`\\\`

3. Use the chat components in your template!\`,
      role: 'assistant'
    },
    {
      id: 'user-2',
      content: 'That looks great! Can I customize the appearance?',
      role: 'user'
    },
    {
      id: 'assistant-2',
      content: 'Yes! CopilotKit is highly customizable. You can customize the appearance using Tailwind CSS classes or by providing your own custom components through the slot system.',
      role: 'assistant'
    }
  ];

  onThumbsUp(event: any) {
    alert('Thumbs up! You liked this message.');
    console.log('Thumbs up event:', event);
  }

  onThumbsDown(event: any) {
    alert('Thumbs down! You disliked this message.');
    console.log('Thumbs down event:', event);
  }
}`,
        language: "typescript",
      },
    },
  },
  render: () => {
    const messages: Message[] = [
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
npm install @copilotkitnext/angular
\`\`\`

2. Import and configure in your component:
\`\`\`typescript
import { provideCopilotKit } from '@copilotkitnext/angular';

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
    ];

    const onThumbsUp = (event: any) => {
      alert("Thumbs up! You liked this message.");
      console.log("Thumbs up event:", event);
    };

    const onThumbsDown = (event: any) => {
      alert("Thumbs down! You disliked this message.");
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
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CopilotChatView,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

@Component({
  selector: 'app-chat-scroll',
  standalone: true,
  imports: [CommonModule, CopilotChatView],
  providers: [
    provideCopilotKit({}),
    provideCopilotChatLabels({
      chatInputPlaceholder: 'Type a message...',
      chatDisclaimerText: 'AI can make mistakes. Please verify important information.'
    })
  ],
  template: \`
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
      <copilot-chat-view
        [messages]="messages"
        [autoScroll]="false">
      </copilot-chat-view>
    </div>
  \`
})
export class ChatScrollComponent {
  messages: Message[] = [];

  constructor() {
    // Generate many messages to show scroll behavior
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        this.messages.push({
          id: \`user-\${i}\`,
          content: \`User message \${i}: This is a test message to demonstrate scrolling behavior.\`,
          role: 'user'
        });
      } else {
        this.messages.push({
          id: \`assistant-\${i}\`,
          content: \`Assistant response \${i}: This is a longer response to demonstrate how the chat interface handles various message lengths and scrolling behavior when there are many messages in the conversation.\`,
          role: 'assistant'
        });
      }
    }
  }
}`,
        language: "typescript",
      },
    },
  },
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
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import {
  CopilotChatView,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat-empty',
  standalone: true,
  imports: [CopilotChatView],
  providers: [
    provideCopilotKit({}),
    provideCopilotChatLabels({
      chatInputPlaceholder: 'Type a message...',
      chatDisclaimerText: 'AI can make mistakes. Please verify important information.'
    })
  ],
  template: \`
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
      <copilot-chat-view [messages]="[]">
      </copilot-chat-view>
    </div>
  \`
})
export class EmptyChatComponent {}`,
        language: "typescript",
      },
    },
  },
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
