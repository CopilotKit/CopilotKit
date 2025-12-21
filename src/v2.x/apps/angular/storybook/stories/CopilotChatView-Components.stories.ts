import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, Injectable, signal } from "@angular/core";
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
import { CustomDisclaimerComponent } from "../components/custom-disclaimer.component";
import { CustomInputComponent } from "../components/custom-input.component";
import { CustomScrollButtonComponent } from "../components/custom-scroll-button.component";

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

export const CustomDisclaimer: Story = {
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

// Custom disclaimer component
&#64;Component({
  selector: 'custom-disclaimer',
  standalone: true,
  template: \`
    <div [class]="inputClass" style="
      text-align: center;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 10px;
      margin: 10px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    ">
      <h3 style="margin: 0 0 10px 0; font-size: 20px;">
        ✨ Custom Disclaimer Component ✨
      </h3>
      <p style="margin: 0; font-size: 14px; opacity: 0.9;">
        {{ '{' }}{{ '{' }} text || 'This is a custom disclaimer demonstrating component overrides!' {{ '}' }}{{ '}' }}
      </p>
      <div style="
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid rgba(255, 255, 255, 0.3);
        font-size: 12px;
        opacity: 0.7;
      ">
        🎨 Styled with custom gradients and animations
      </div>
    </div>
  \`
})
class CustomDisclaimerComponent {
  &#64;Input() text?: string;
  &#64;Input() inputClass?: string;
}

&#64;Component({
  selector: 'app-custom-disclaimer',
  standalone: true,
  imports: [
    CommonModule,
    CopilotChatView,
    CopilotChatMessageView,
    CopilotChatInput,
    CustomDisclaimerComponent
  ],
  providers: [
    provideCopilotKit({}),
    provideCopilotChatLabels({
      chatInputPlaceholder: "Type a message...",
      chatDisclaimerText:
        "AI can make mistakes. Please verify important information.",
    })
  ],
  template: \`
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
      <copilot-chat-view
        [messages]="messages"
        [disclaimerComponent]="customDisclaimerComponent">
      </copilot-chat-view>
    </div>
  \`
})
export class CustomDisclaimerExampleComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Hello! Can you help me with TypeScript?',
      role: 'user'
    },
    {
      id: 'assistant-1',
      content: 'Of course! TypeScript is a superset of JavaScript that adds static typing. What would you like to know?',
      role: 'assistant'
    }
  ];

  customDisclaimerComponent = CustomDisclaimerComponent;
}`,
        language: "typescript",
      },
    },
  },
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
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  ChatState,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

// Custom input component
&#64;Component({
  selector: 'custom-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: \`
    <div [class]="inputClass" style="
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      padding: 20px;
      border-radius: 15px;
      margin: 10px;
    ">
      <input 
        type="text"
        [(ngModel)]="inputValue"
        placeholder="💬 Ask me anything..."
        style="
          width: 100%;
          padding: 15px;
          border: 2px solid white;
          border-radius: 10px;
          font-size: 16px;
          background: rgba(255, 255, 255, 0.9);
          color: #333;
          outline: none;
        "
        (keyup.enter)="handleSend()"
      />
      <button 
        style="
          margin-top: 10px;
          padding: 10px 20px;
          background: white;
          color: #f5576c;
          border: none;
          border-radius: 5px;
          font-weight: bold;
          cursor: pointer;
        "
        (click)="handleSend()">
        Send Message ✨
      </button>
    </div>
  \`
})
class CustomInputComponent {
  &#64;Input() inputClass?: string;
  
  inputValue = '';
  
  constructor(private chat: ChatState) {}
  
  handleSend() {
    const value = this.inputValue.trim();
    if (value) {
      this.chat.submitInput(value);
      this.inputValue = '';
    }
  }
}

&#64;Component({
  selector: 'app-custom-input',
  standalone: true,
  imports: [
    CommonModule,
    CopilotChatView,
    CopilotChatMessageView,
    CopilotChatInput,
    CustomInputComponent
  ],
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
        [inputComponent]="customInputComponent">
      </copilot-chat-view>
    </div>
  \`
})
export class CustomInputExampleComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Check out this custom input!',
      role: 'user'
    },
    {
      id: 'assistant-1',
      content: 'That\'s a beautiful custom input component! The gradient and styling look great.',
      role: 'assistant'
    }
  ];

  customInputComponent = CustomInputComponent;
}`,
        language: "typescript",
      },
    },
  },
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
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

// Custom scroll button component
&#64;Component({
  selector: 'custom-scroll-button',
  standalone: true,
  imports: [CommonModule],
  template: \`
    <button 
      type="button"
      (click)="handleClick()"
      [class]="inputClass"
      [class.hover]="isHovered"
      (mouseenter)="isHovered = true"
      (mouseleave)="isHovered = false"
      style="
        position: fixed;
        bottom: 100px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
        z-index: 1000;
      "
      [style.transform]="isHovered ? 'scale(1.1)' : 'scale(1)'">
      <span style="color: white; font-size: 24px; pointer-events: none;">⬇️</span>
    </button>
  \`,
  styles: [\`
    button.hover {
      transform: scale(1.1);
    }
  \`]
})
class CustomScrollButtonComponent {
  &#64;Input() onClick?: () => void;
  &#64;Input() inputClass?: string;
  &#64;Output() clicked = new EventEmitter<void>();
  
  isHovered = false;
  
  handleClick() {
    this.clicked.emit();
    if (this.onClick) {
      this.onClick();
    }
  }
}

&#64;Component({
  selector: 'app-custom-scroll',
  standalone: true,
  imports: [
    CommonModule,
    CopilotChatView,
    CopilotChatMessageView,
    CopilotChatInput,
    CustomScrollButtonComponent
  ],
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
        [autoScroll]="false"
        [scrollToBottomButtonComponent]="scrollToBottomButtonComponent">
      </copilot-chat-view>
    </div>
  \`
})
export class CustomScrollButtonExampleComponent {
  messages: Message[] = [];
  scrollToBottomButtonComponent = CustomScrollButtonComponent;

  constructor() {
    // Generate many messages to show scroll behavior
    for (let i = 0; i < 20; i++) {
      this.messages.push({
        id: \`msg-\${i}\`,
        content: \`Message \${i}: This is a test message to demonstrate the custom scroll button.\`,
        role: i % 2 === 0 ? 'user' : 'assistant'
      } as Message);
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

&#64;Component({
  selector: 'app-no-feather',
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
    })
  ],
  template: \`
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden;">
      <copilot-chat-view
        [messages]="messages"
        [featherComponent]="null">
      </copilot-chat-view>
    </div>
  \`
})
export class NoFeatherEffectComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Hello!',
      role: 'user'
    },
    {
      id: 'assistant-1',
      content: 'Hi there! How can I help you today?',
      role: 'assistant'
    }
  ];
}`,
        language: "typescript",
      },
    },
  },
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
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CopilotChatView,
  CopilotChatMessageView,
  CopilotChatInput,
  ChatState,
  provideCopilotKit,
  provideCopilotChatLabels
} from '@copilotkitnext/angular';
import { Message } from '@ag-ui/client';

// Minimal custom input component with service injection
&#64;Component({
  selector: 'service-based-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: \`
    <div style="
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 20px;
      border-radius: 15px;
      margin: 10px;
    ">
      <h4 style="color: white; margin: 0 0 10px 0;">
        Service-Based Custom Input
      </h4>
      <div style="display: flex; gap: 10px;">
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
          (click)="submit()">
          Submit
        </button>
      </div>
      <p style="color: rgba(255, 255, 255, 0.9); font-size: 12px; margin: 8px 0 0 0;">
        This component uses ChatState.submitInput()
      </p>
    </div>
  \`
})
class ServiceBasedInputComponent {
  value = '';
  
  constructor(private chat: ChatState) {}
  
  submit() {
    const trimmedValue = this.value.trim();
    if (!trimmedValue) return;
    
    // Use the service to submit the message
    this.chat.submitInput(trimmedValue);
    this.value = '';
  }
}

&#64;Component({
  selector: 'app-service-based-example',
  standalone: true,
  imports: [
    CommonModule,
    CopilotChatView,
    CopilotChatMessageView,
    CopilotChatInput,
    ServiceBasedInputComponent
  ],
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
        [inputComponent]="customInputComponent">
      </copilot-chat-view>
    </div>
  \`
})
export class ServiceBasedExampleComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'How does the service-based approach work?',
      role: 'user'
    },
    {
      id: 'assistant-1',
      content: 'The service-based approach uses Angular\\'s dependency injection to access ChatState, which provides the submitInput() method for sending messages. This is the idiomatic Angular pattern!',
      role: 'assistant'
    }
  ];

  customInputComponent = ServiceBasedInputComponent;
}`,
        language: "typescript",
      },
    },
  },
  render: () => {
    // Define the service-based input component inline for the story
    @Component({
      selector: "story-service-input",
      standalone: true,
      imports: [CommonModule, FormsModule],
      template: `
        <div
          style="
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          padding: 20px;
          border-radius: 15px;
          margin: 10px;
        "
        >
          <h4 style="color: white; margin: 0 0 10px 0;">
            Service-Based Custom Input
          </h4>
          <div style="display: flex; gap: 10px;">
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
            style="color: rgba(255, 255, 255, 0.9); font-size: 12px; margin: 8px 0 0 0;"
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
