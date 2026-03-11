import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, Injectable, Input, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  ChatState,
  provideCopilotChatLabels,
  provideCopilotKit,
} from "@copilotkitnext/angular";
import { Message } from "@ag-ui/client";

@Injectable()
class StoryChatState extends ChatState {
  readonly inputValue = signal<string>("");

  submitInput(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    console.log("[Storybook] submitInput", trimmed);
    this.inputValue.set("");
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }
}

// Custom input components defined after imports
const meta: Meta<CopilotChatView> = {
  title: "UI/CopilotChatView/Customized with Templates",
  component: CopilotChatView,
  decorators: [
    moduleMetadata({
      imports: [
        CommonModule,
        FormsModule,
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

export const CustomDisclaimerTemplate: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "How do I use templates for customization?",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "Templates provide a powerful way to customize components! You can use ng-template with template references to inject custom HTML directly into the component slots.",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <!-- Custom Disclaimer Template -->
          <ng-template #customDisclaimer>
            <div style="
              text-align: center;
              padding: 16px;
              background: linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 100%);
              color: white;
              font-size: 14px;
              font-weight: 600;
              margin: 12px 20px;
              border-radius: 12px;
              box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
              position: relative;
              overflow: hidden;
            ">
              <div style="
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
                transform: rotate(45deg);
                animation: shimmer 3s infinite;
              "></div>
              <span style="position: relative; z-index: 1;">
                ⚡ Template-based customization - AI assistance at your fingertips!
              </span>
            </div>
          </ng-template>

          <copilot-chat-view
            [messages]="messages"
            [disclaimerTemplate]="customDisclaimer">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
      },
    };
  },
};

// Custom input component for template story
@Component({
  selector: "template-custom-input",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 24px;
      margin: 0;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
    "
    >
      <div
        style="
        display: flex;
        gap: 12px;
        max-width: 1200px;
        margin: 0 auto;
      "
      >
        <input
          type="text"
          [(ngModel)]="inputValue"
          placeholder="✨ Type your message here..."
          style="
            flex: 1;
            padding: 16px 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 12px;
            font-size: 16px;
            background: rgba(255, 255, 255, 0.95);
            color: #333;
            outline: none;
            transition: all 0.3s ease;
          "
          (keyup.enter)="sendMessage()"
        />
        <button
          style="
            padding: 16px 32px;
            background: white;
            color: #667eea;
            border: none;
            border-radius: 12px;
            font-weight: bold;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          "
          (click)="sendMessage()"
        >
          Send
        </button>
      </div>
      <div
        style="
        text-align: center;
        margin-top: 8px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.8);
      "
      >
        Press Enter to send • Powered by Templates
      </div>
    </div>
  `,
})
class TemplateCustomInputComponent {
  inputValue = "";

  constructor(private chat: ChatState) {}

  sendMessage() {
    const value = this.inputValue.trim();
    if (value) {
      this.chat.submitInput(value);
      this.inputValue = "";
    }
  }
}

export const CustomInputTemplate: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "This input is created with a component!",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "Yes! Components with service injection provide complete control over the input area, including custom styling and behavior.",
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
        customInputComponent: TemplateCustomInputComponent,
      },
    };
  },
};

export const CustomScrollButtonTemplate: Story = {
  render: () => {
    // Generate many messages to show scroll behavior
    const messages: Message[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push({
        id: `msg-${i}`,
        content:
          i % 2 === 0
            ? `User message ${i}: Template-based scroll button demonstration!`
            : `Assistant response ${i}: Templates provide maximum flexibility for UI customization, allowing you to create exactly the experience you want.`,
        role: i % 2 === 0 ? "user" : "assistant",
      } as Message);
    }

    // Simple click handler without DOM manipulation
    const handleScroll = (onClick: () => void) => {
      onClick();
    };

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <!-- Custom Scroll Button Template -->
          <ng-template #customScrollButton let-onClick="onClick">
            <button 
              (click)="handleScroll(onClick)"
              (mouseenter)="isHovered = true"
              (mouseleave)="isHovered = false"
              style="
                position: fixed;
                bottom: 100px;
                right: 30px;
                width: 64px;
                height: 64px;
                border-radius: 50%;
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                border: 3px solid white;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 1000;
              "
              [style.transform]="isHovered ? 'scale(1.15) rotate(360deg)' : 'scale(1) rotate(0deg)'">
              <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                color: white;
              ">
                <span style="font-size: 24px;">↓</span>
                <span style="font-size: 10px; margin-top: -4px;">SCROLL</span>
              </div>
            </button>
          </ng-template>

          <copilot-chat-view
            [messages]="messages"
            [autoScroll]="false"
            [scrollToBottomButtonTemplate]="customScrollButton">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        handleScroll,
        isHovered: false,
      },
    };
  },
};

// Custom input component for combined story
@Component({
  selector: "combined-custom-input",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      style="
      background: linear-gradient(90deg, #00d2ff 0%, #3a47d5 100%);
      padding: 20px;
    "
    >
      <input
        type="text"
        [(ngModel)]="inputValue"
        placeholder="Template-powered input..."
        style="
          width: calc(100% - 100px);
          padding: 12px;
          border: 2px solid white;
          border-radius: 8px;
          font-size: 16px;
          outline: none;
        "
        (keyup.enter)="sendMessage()"
      />
      <button
        style="
          width: 80px;
          padding: 12px;
          margin-left: 10px;
          background: white;
          color: #3a47d5;
          border: none;
          border-radius: 8px;
          font-weight: bold;
          cursor: pointer;
        "
        (click)="sendMessage()"
      >
        Go
      </button>
    </div>
  `,
})
class CombinedCustomInputComponent {
  inputValue = "";

  constructor(private chat: ChatState) {}

  sendMessage() {
    const value = this.inputValue.trim();
    if (value) {
      this.chat.submitInput(value);
      this.inputValue = "";
    }
  }
}

export const AllTemplatesCombined: Story = {
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Show me all templates working together!",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content:
          "Here you can see custom disclaimer, input, and scroll button templates all working in harmony!",
        role: "assistant" as const,
      },
      {
        id: "user-2",
        content: "This is amazing flexibility!",
        role: "user" as const,
      },
      {
        id: "assistant-2",
        content:
          "Templates give you complete control over every aspect of the chat interface while maintaining the core functionality.",
        role: "assistant" as const,
      },
    ];

    return {
      template: `
        <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
          <!-- Combined Templates -->
          <ng-template #disclaimer>
            <div style="
              text-align: center;
              padding: 12px;
              background: linear-gradient(90deg, #00d2ff 0%, #3a47d5 100%);
              color: white;
              font-size: 13px;
              margin: 8px 16px;
              border-radius: 8px;
            ">
              🚀 All custom templates active!
            </div>
          </ng-template>

          <ng-template #scrollBtn let-onClick="onClick">
            <button 
              (click)="onClick()"
              style="
                position: fixed;
                bottom: 90px;
                right: 20px;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: linear-gradient(90deg, #00d2ff 0%, #3a47d5 100%);
                border: 2px solid white;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                cursor: pointer;
                color: white;
                font-size: 20px;
              ">
              ↓
            </button>
          </ng-template>

          <copilot-chat-view
            [messages]="messages"
            [autoScroll]="false"
            [disclaimerTemplate]="disclaimer"
            [inputComponent]="customInputComponent"
            [scrollToBottomButtonTemplate]="scrollBtn">
          </copilot-chat-view>
        </div>
      `,
      props: {
        messages,
        customInputComponent: CombinedCustomInputComponent,
      },
    };
  },
};
