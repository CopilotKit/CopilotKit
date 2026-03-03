import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotChatLabels,
  provideCopilotKit,
} from "@copilotkitnext/angular";
import { Message } from "@ag-ui/client";

const meta: Meta<CopilotChatView> = {
  title: "UI/CopilotChatView/Customized with CSS",
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

// Story with custom disclaimer text
export const CustomDisclaimerText: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Hello!",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content: "Hi there! How can I help you today?",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [disclaimerText]="'This is a custom disclaimer message for your chat interface.'">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
      },
    };
  },
};

export const AnimatedDisclaimer: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Hello! Can you help me with styling?",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content: `Absolutely! I can help you with CSS styling, design patterns, and UI/UX best practices. What specific styling challenge are you working on?`,
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <style>
            .custom-disclaimer {
              background: linear-gradient(90deg, #FF6B6B 0%, #4ECDC4 50%, #45B7D1 100%);
              color: white;
              font-weight: 600;
              font-size: 14px;
              padding: 16px 24px;
              margin: 12px 20px;
              border-radius: 12px;
              text-align: center;
              box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
              animation: pulse 3s ease-in-out infinite;
              position: relative;
              overflow: hidden;
            }
            
            .custom-disclaimer::before {
              content: '';
              position: absolute;
              top: -50%;
              left: -50%;
              width: 200%;
              height: 200%;
              background: linear-gradient(
                45deg,
                transparent,
                rgba(255, 255, 255, 0.1),
                transparent
              );
              transform: rotate(45deg);
              animation: shimmer 3s infinite;
            }
            
            @keyframes pulse {
              0%, 100% {
                transform: scale(1);
              }
              50% {
                transform: scale(1.02);
              }
            }
            
            @keyframes shimmer {
              0% {
                transform: translateX(-100%) translateY(-100%) rotate(45deg);
              }
              100% {
                transform: translateX(100%) translateY(100%) rotate(45deg);
              }
            }
            
            .custom-disclaimer-text {
              position: relative;
              z-index: 1;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
            }
            
            .custom-disclaimer-icon {
              font-size: 20px;
              animation: bounce 2s infinite;
            }
            
            @keyframes bounce {
              0%, 100% {
                transform: translateY(0);
              }
              50% {
                transform: translateY(-5px);
              }
            }
          </style>
          
          <copilot-chat-view
            [messages]="messages"
            [disclaimerClass]="'custom-disclaimer'"
            [disclaimerText]="'✨ Styled with custom CSS classes - AI responses may need verification ✨'">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
      },
    };
  },
};
