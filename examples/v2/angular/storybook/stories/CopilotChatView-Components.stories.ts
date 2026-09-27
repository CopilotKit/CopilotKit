import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, Injectable } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  ChatState,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import { StoryChatState } from "./support/story-chat-state";
import type { Message } from "@ag-ui/client";
import { CustomDisclaimerComponent } from "../components/custom-disclaimer.component";
import { CustomInputComponent } from "../components/custom-input.component";
import { CustomScrollButtonComponent } from "../components/custom-scroll-button.component";

const meta: Meta<CopilotChatView> = {
  title: "UI/CopilotChatView/Customized with Components",
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

export const CustomDisclaimer: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Hello! Can you help me with TypeScript?",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "Of course! TypeScript is a superset of JavaScript that adds static typing. What would you like to know?",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [disclaimerComponent]="customDisclaimerComponent">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        customDisclaimerComponent: CustomDisclaimerComponent,
      },
    };
  },
};

export const CustomInput: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Check out this custom input!",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "That's a beautiful custom input component! The gradient and styling look great.",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [inputComponent]="customInputComponent">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        customInputComponent: CustomInputComponent,
      },
    };
  },
};

export const CustomScrollButton: Story = {
  render: () => {
    // Generate many messages to show scroll behavior
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `msg-${i}`,
        content: `Message ${i}: This is a test message to demonstrate the custom scroll button.`,
        role: i % 2 === 0 ? "user" : "assistant",
      } as Message);
    }

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [autoScroll]="false"
            [scrollToBottomButtonComponent]="scrollToBottomButtonComponent">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        scrollToBottomButtonComponent: CustomScrollButtonComponent,
      },
    };
  },
};

export const NoFeatherEffect: Story = {
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
            [featherComponent]="null">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
      },
    };
  },
};

export const CustomInputServiceBased: Story = {
  name: "Custom Input via Service (Recommended)",
  parameters: {
    docs: {
      description: {
        story: `
Demonstrates the recommended approach for custom inputs using service injection.

This pattern uses \`ChatState.submitInput()\` to submit messages, 
which is the idiomatic Angular approach for cross-component communication.

**Key differences from React:**
- Angular uses dependency injection with services
- React uses callback props (e.g., \`onSubmitMessage\`)
- Both achieve the same result with framework-appropriate patterns
        `,
      },
    },
  },
  render: () => {
    // Define the service-based input component inline for the story
    @Component({
      selector: "story-service-input",
      standalone: true,
      imports: [FormsModule],
      template: `
        <div
          style="
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            padding: 20px;
            border-radius: 15px;
            margin: 10px;
          "
        >
          <h4 style="color: white; margin: 0 0 10px 0">Service-Based Custom Input</h4>
          <div style="display: flex; gap: 10px">
            <input
              type="text"
              [(ngModel)]="value"
              placeholder="Type your message..."
              style="
                flex: 1;
                padding: 12px;
                border: 2px solid white;
                border-radius: 8px;
                font-size: 14px;
                background: rgba(255, 255, 255, 0.95);
                color: #333;
                outline: none;
              "
              (keyup.enter)="submit()"
            />
            <button
              style="
                padding: 12px 24px;
                background: white;
                color: #059669;
                border: none;
                border-radius: 8px;
                font-weight: bold;
                cursor: pointer;
              "
              (click)="submit()"
            >
              Submit
            </button>
          </div>
          <p
            style="color: rgba(255, 255, 255, 0.9); font-size: 12px; margin: 8px 0 0 0"
          >
            This component uses ChatState.submitInput()
          </p>
        </div>
      `,
    })
    class StoryServiceInputComponent {
      value = "";

      constructor(private chat: ChatState) {}

      submit() {
        const trimmedValue = this.value.trim();
        if (!trimmedValue) return;

        this.chat.submitInput(trimmedValue);
        this.value = "";
      }
    }

    const messages: Message[] = [
      {
        id: "user-1",
        content: "How does the service-based approach work?",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "The service-based approach uses Angular's dependency injection to access ChatState, which provides the submitInput() method for sending messages. This is the idiomatic Angular pattern!",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <copilot-chat-view
            [messages]="messages"
            [inputComponent]="customInputComponent">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        customInputComponent: StoryServiceInputComponent,
      },
    };
  },
};
