import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, Injectable, input, signal } from "@angular/core";
import {
  CopilotChatMessageView,
  CopilotChatMessageViewCursor,
  CopilotKit,
  provideCopilotKit,
  provideCopilotChatLabels,
  Message,
  RenderToolCallConfig,
  ToolRenderer,
  AngularToolCall,
} from "@copilotkitnext/angular";
import { ToolCallStatus } from "@copilotkitnext/core";
import { z } from "zod"; // Schema validation

const meta: Meta<CopilotChatMessageView> = {
  title: "UI/CopilotChatMessageView",
  component: CopilotChatMessageView,
  parameters: {
    docs: {
      description: {
        component:
          "A simple conversation between user and AI using CopilotChatMessageView component.",
      },
    },
  },
  decorators: [
    moduleMetadata({
      imports: [
        CommonModule,
        CopilotChatMessageView,
        CopilotChatMessageViewCursor,
      ],
      providers: [
        provideCopilotChatLabels({
          assistantMessageToolbarCopyMessageLabel: "Copy",
          assistantMessageToolbarCopyCodeLabel: "Copy",
          assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
          assistantMessageToolbarThumbsUpLabel: "Good response",
          assistantMessageToolbarThumbsDownLabel: "Bad response",
          assistantMessageToolbarReadAloudLabel: "Read aloud",
          assistantMessageToolbarRegenerateLabel: "Regenerate",
          userMessageToolbarCopyMessageLabel: "Copy",
          userMessageToolbarEditMessageLabel: "Edit",
        }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<CopilotChatMessageView>;

// Default story with full conversation - matches React exactly
export const Default: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatMessageView, Message } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatMessageView],
  template: \`
    <copilot-chat-message-view
      [messages]="messages"
>
    </copilot-chat-message-view>
  \`
})
export class ChatComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Hello! Can you help me understand how React hooks work?',
      role: 'user',
    },
    {
      id: 'assistant-1',
      content: \`React hooks are functions that let you use state and other React features in functional components. Here are the most common ones:

- **useState** - Manages local state
- **useEffect** - Handles side effects
- **useContext** - Accesses context values
- **useCallback** - Memoizes functions
- **useMemo** - Memoizes values

Would you like me to explain any of these in detail?\`,
      role: 'assistant',
    },
    {
      id: 'user-2',
      content: 'Yes, could you explain useState with a simple example?',
      role: 'user',
    },
    {
      id: 'assistant-2',
      content: \`Absolutely! Here's a simple useState example:

\\\`\\\`\\\`jsx
import React, { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>You clicked {count} times</p>
      <button onClick={() => setCount(count + 1)}>
        Click me
      </button>
    </div>
  );
}
\\\`\\\`\\\`

In this example:
- \\\`useState(0)\\\` initializes the state with value 0
- It returns an array: \\\`[currentValue, setterFunction]\\\`
- \\\`count\\\` is the current state value
- \\\`setCount\\\` is the function to update the state\`,
      role: 'assistant',
    },
  ];

  // Note: In Angular, thumbs up/down actions are handled through the chat configuration service
  // or by providing a custom assistant message component
}`,
        language: "typescript",
      },
    },
  },
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Hello! Can you help me understand how React hooks work?",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content: `React hooks are functions that let you use state and other React features in functional components. Here are the most common ones:

- **useState** - Manages local state
- **useEffect** - Handles side effects
- **useContext** - Accesses context values
- **useCallback** - Memoizes functions
- **useMemo** - Memoizes values

Would you like me to explain any of these in detail?`,
        role: "assistant" as const,
      },
      {
        id: "user-2",
        content: "Yes, could you explain useState with a simple example?",
        role: "user" as const,
      },
      {
        id: "assistant-2",
        content: `Absolutely! Here's a simple useState example:

\`\`\`jsx
import React, { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>You clicked {count} times</p>
      <button onClick={() => setCount(count + 1)}>
        Click me
      </button>
    </div>
  );
}
\`\`\`

In this example:
- \`useState(0)\` initializes the state with value 0
- It returns an array: \`[currentValue, setterFunction]\`
- \`count\` is the current state value
- \`setCount\` is the function to update the state`,
        role: "assistant" as const,
      },
    ];

    return {
      props: {
        messages,
      },
      template: `
        <div style="height: 100vh; margin: 0; padding: 0;">
          <copilot-chat-message-view
            [messages]="messages"
      >
          </copilot-chat-message-view>
        </div>
      `,
    };
  },
};

// ShowCursor story - matches React exactly
export const ShowCursor: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatMessageView, Message } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatMessageView],
  template: \`
    <copilot-chat-message-view
      [messages]="messages"
      [showCursor]="true"
>
    </copilot-chat-message-view>
  \`
})
export class ChatComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Can you explain how AI models work?',
      role: 'user',
    },
  ];

  // Note: In Angular, thumbs up/down actions are handled through the chat configuration service
  // or by providing a custom assistant message component
}`,
        language: "typescript",
      },
    },
  },
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content: "Can you explain how AI models work?",
        role: "user" as const,
      },
    ];

    return {
      props: {
        messages,
        showCursor: true,
      },
      template: `
        <div style="height: 100vh; margin: 0; padding: 0;">
          <copilot-chat-message-view
            [messages]="messages"
            [showCursor]="showCursor"
      >
          </copilot-chat-message-view>
        </div>
      `,
    };
  },
};

// Define Zod schema for search args
const searchArgsSchema = z.object({
  query: z.string(),
  filters: z.array(z.string()).optional(),
});

// Infer type from schema
type SearchArgs = z.infer<typeof searchArgsSchema>;

// SearchToolRender component with explicit inputs
@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [style]="containerStyle">
      <div style="font-weight: bold; margin-bottom: 4px;">🔍 Search Tool</div>
      <div style="font-size: 14px; color: #666;">
        Query: {{ args?.query }}
        @if (args?.filters && args.filters.length > 0) {
          <div>Filters: {{ args.filters.join(", ") }}</div>
        }
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #0066cc;">Searching...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #006600;">
          Results: {{ result }}
        </div>
      }
    </div>
  `,
})
class SearchToolRenderComponent implements ToolRenderer<SearchArgs> {
  readonly ToolCallStatus = ToolCallStatus;
  readonly toolCall = input.required<AngularToolCall<SearchArgs>>();

  get call(): AngularToolCall<SearchArgs> {
    return this.toolCall();
  }

  get args(): Partial<SearchArgs> | SearchArgs {
    return this.call.args;
  }

  get status() {
    return this.call.status;
  }

  get result(): string | undefined {
    const call = this.call;
    return call.status === "complete" ? call.result : undefined;
  }

  get containerStyle() {
    return {
      padding: "12px",
      margin: "8px 0",
      "background-color": this.status === "in-progress" ? "#f0f4f8" : "#e6f3ff",
      "border-radius": "8px",
      border: "1px solid #cce0ff",
    };
  }
}

// Define Zod schema for calculator args
const calculatorArgsSchema = z.object({
  expression: z.string(),
});

// Infer type from schema
type CalculatorArgs = z.infer<typeof calculatorArgsSchema>;

// Service for shared counter state
@Injectable({ providedIn: "root" })
export class CalculatorCounterService {
  readonly counter = signal(0);
}

// CalculatorToolRender component with interactive counters
@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [style]="containerStyle">
      <div style="font-weight: bold; margin-bottom: 4px;">🧮 Calculator</div>
      <div style="font-size: 14px; color: #666;">
        Expression: {{ args?.expression }}
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #cc6600;">Calculating...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #006600;">Result: {{ result }}</div>
      }
      <div
        style="margin-top: 12px; padding: 8px; background-color: #fff8e6; border-radius: 4px;"
      >
        <div style="font-size: 13px; color: #666; margin-bottom: 4px;">
          Local counter: {{ counter() }}
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button
            (click)="decrementLocal()"
            style="padding: 4px 12px; background-color: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer;"
          >
            -
          </button>
          <button
            (click)="incrementLocal()"
            style="padding: 4px 12px; background-color: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer;"
          >
            +
          </button>
        </div>

        <div style="border-top: 1px solid #ffcc66; padding-top: 8px;">
          <div
            style="font-size: 13px; color: #666; margin-bottom: 4px; font-weight: bold;"
          >
            Global counter: {{ globalCounter() }}
          </div>
          <div style="display: flex; gap: 8px;">
            <button
              (click)="decrementGlobal()"
              style="padding: 4px 12px; background-color: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer;"
            >
              Global -
            </button>
            <button
              (click)="incrementGlobal()"
              style="padding: 4px 12px; background-color: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer;"
            >
              Global +
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
class CalculatorToolRenderComponent implements ToolRenderer<CalculatorArgs> {
  readonly ToolCallStatus = ToolCallStatus;
  readonly toolCall = input.required<AngularToolCall<CalculatorArgs>>();

  counter = signal(0);

  // This will be passed from the parent
  constructor(private readonly calcCounter: CalculatorCounterService) {}
  globalCounter = this.calcCounter.counter;

  get call(): AngularToolCall<CalculatorArgs> {
    return this.toolCall();
  }

  get args(): Partial<CalculatorArgs> | CalculatorArgs {
    return this.call.args;
  }

  get status() {
    return this.call.status;
  }

  get result(): string | undefined {
    const call = this.call;
    return call.status === ToolCallStatus.Complete ? call.result : undefined;
  }

  get containerStyle() {
    return {
      padding: "12px",
      margin: "8px 0",
      "background-color": this.status === "in-progress" ? "#fff9e6" : "#fff4cc",
      "border-radius": "8px",
      border: "1px solid #ffcc66",
    };
  }

  incrementLocal() {
    this.counter.update((v) => v + 1);
  }

  decrementLocal() {
    this.counter.update((v) => v - 1);
  }

  incrementGlobal() {
    this.calcCounter.counter.update((v) => v + 1);
  }

  decrementGlobal() {
    this.calcCounter.counter.update((v) => v - 1);
  }
}

// WildcardToolRender component for unmatched tools
@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      style="padding: 12px; margin: 8px 0; background-color: #f5f5f5; border-radius: 8px; border: 1px solid #ddd;"
    >
      <div style="font-weight: bold; margin-bottom: 4px;">
        🔧 Tool Execution
      </div>
      <div style="font-size: 14px; color: #666;">
        <pre>{{ argsJson }}</pre>
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #666;">Processing...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #333;">Output: {{ result }}</div>
      }
    </div>
  `,
})
class WildcardToolRenderComponent
  implements ToolRenderer<Record<string, unknown>>
{
  readonly ToolCallStatus = ToolCallStatus;
  readonly toolCall =
    input.required<AngularToolCall<Record<string, unknown>>>();

  get call(): AngularToolCall<Record<string, unknown>> {
    return this.toolCall();
  }

  get args(): Partial<Record<string, unknown>> {
    return this.call.args;
  }

  get status() {
    return this.call.status;
  }

  get result(): string | undefined {
    const call = this.call;
    return call.status === ToolCallStatus.Complete ? call.result : undefined;
  }

  get argsJson() {
    return JSON.stringify(this.args, null, 2);
  }
}

const renderToolCallConfigs: RenderToolCallConfig[] = [
  {
    name: "search",
    args: searchArgsSchema,
    component: SearchToolRenderComponent,
  },
  {
    name: "calculator",
    args: calculatorArgsSchema,
    component: CalculatorToolRenderComponent,
  },
  {
    name: "*",
    args: z.record(z.string(), z.any()),
    component: WildcardToolRenderComponent,
  },
];

// WithToolCalls story - matches React exactly
export const WithToolCalls: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      source: {
        type: "code",
        code: `import { Component, Input, signal, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  CopilotChatMessageView, 
  CopilotKit,
  Message, 
  ToolCall, 
  ToolMessage,
  provideCopilotKit
} from '@copilotkitnext/angular';
import { ToolCallStatus } from '@copilotkitnext/core';
import { z } from 'zod';

// Define Zod schema for search args
const searchArgsSchema = z.object({
  query: z.string(),
  filters: z.array(z.string()).optional(),
});

// Infer type from schema
type SearchArgs = z.infer<typeof searchArgsSchema>;

// SearchToolRender component
@Component({
  standalone: true,
  imports: [CommonModule],
  template: \`
    <div [style]="containerStyle">
      <div style="font-weight: bold; margin-bottom: 4px;">🔍 Search Tool</div>
      <div style="font-size: 14px; color: #666;">
        Query: {{ args?.query }}
        @if (args?.filters && args.filters.length > 0) {
          <div>Filters: {{ args.filters.join(", ") }}</div>
        }
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #0066cc;">Searching...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #006600;">
          Results: {{ result }}
        </div>
      }
    </div>
  \`
})
class SearchToolRenderComponent {
  readonly ToolCallStatus = ToolCallStatus;
  @Input({ required: true }) name!: string;
  @Input({ required: true }) args!: SearchArgs | Partial<SearchArgs>;
  @Input({ required: true }) status!: ToolCallStatus;
  @Input() result?: string;
  
  get containerStyle() {
    return {
      'padding': '12px',
      'margin': '8px 0',
      'background-color': this.status === ToolCallStatus.InProgress ? '#f0f4f8' : '#e6f3ff',
      'border-radius': '8px',
      'border': '1px solid #cce0ff'
    };
  }
}

// Define Zod schema for calculator args
const calculatorArgsSchema = z.object({
  expression: z.string(),
});

// Infer type from schema
type CalculatorArgs = z.infer<typeof calculatorArgsSchema>;

// Service for shared counter state
@Injectable({ providedIn: 'root' })
export class CalculatorCounterService {
  readonly counter = signal(0);
}

// CalculatorToolRender component with interactive counters
@Component({
  standalone: true,
  imports: [CommonModule],
  template: \`
    <div [style]="containerStyle">
      <div style="font-weight: bold; margin-bottom: 4px;">🧮 Calculator</div>
      <div style="font-size: 14px; color: #666;">
        Expression: {{ args?.expression }}
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #cc6600;">Calculating...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #006600;">
          Result: {{ result }}
        </div>
      }
      <div style="margin-top: 12px; padding: 8px; background-color: #fff8e6; border-radius: 4px;">
        <div style="font-size: 13px; color: #666; margin-bottom: 4px;">
          Local counter: {{ counter() }}
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button 
            (click)="decrementLocal()"
            style="padding: 4px 12px; background-color: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer;">
            -
          </button>
          <button 
            (click)="incrementLocal()"
            style="padding: 4px 12px; background-color: #ff9933; color: white; border: none; border-radius: 4px; cursor: pointer;">
            +
          </button>
        </div>
        
        <div style="border-top: 1px solid #ffcc66; padding-top: 8px;">
          <div style="font-size: 13px; color: #666; margin-bottom: 4px; font-weight: bold;">
            Global counter: {{ globalCounter() }}
          </div>
          <div style="display: flex; gap: 8px;">
            <button 
              (click)="decrementGlobal()"
              style="padding: 4px 12px; background-color: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Global -
            </button>
            <button 
              (click)="incrementGlobal()"
              style="padding: 4px 12px; background-color: #cc6600; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Global +
            </button>
          </div>
        </div>
      </div>
    </div>
  \`
})
class CalculatorToolRenderComponent {
  readonly ToolCallStatus = ToolCallStatus;
  @Input({ required: true }) name!: string;
  @Input({ required: true }) args!: CalculatorArgs | Partial<CalculatorArgs>;
  @Input({ required: true }) status!: ToolCallStatus;
  @Input() result?: string;
  
  counter = signal(0);
  
  constructor(private readonly calcCounter: CalculatorCounterService) {}
  globalCounter = this.calcCounter.counter;

  get containerStyle() {
    return {
      'padding': '12px',
      'margin': '8px 0',
      'background-color': this.status === ToolCallStatus.InProgress ? '#fff9e6' : '#fff4cc',
      'border-radius': '8px',
      'border': '1px solid #ffcc66'
    };
  }

  incrementLocal() {
    this.counter.update(v => v + 1);
  }

  decrementLocal() {
    this.counter.update(v => v - 1);
  }

  incrementGlobal() {
    this.calcCounter.counter.update(v => v + 1);
  }

  decrementGlobal() {
    this.calcCounter.counter.update(v => v - 1);
  }
}

// WildcardToolRender component for unmatched tools
@Component({
  standalone: true,
  imports: [CommonModule],
  template: \`
    <div style="padding: 12px; margin: 8px 0; background-color: #f5f5f5; border-radius: 8px; border: 1px solid #ddd;">
      <div style="font-weight: bold; margin-bottom: 4px;">🔧 Tool Execution</div>
      <div style="font-size: 14px; color: #666;">
        <pre>{{ argsJson }}</pre>
      </div>
      @if (status === ToolCallStatus.InProgress) {
        <div style="margin-top: 8px; color: #666;">Processing...</div>
      }
      @if (status === ToolCallStatus.Complete && result) {
        <div style="margin-top: 8px; color: #333;">
          Output: {{ result }}
        </div>
      }
    </div>
  \`
})
class WildcardToolRenderComponent {
  readonly ToolCallStatus = ToolCallStatus;
  @Input({ required: true }) name!: string;
  @Input({ required: true }) args!: any;
  @Input({ required: true }) status!: ToolCallStatus;
  @Input() result?: string;

  get argsJson() {
    return JSON.stringify(this.args, null, 2);
  }
}

// Main chat component
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CopilotChatMessageView,
    SearchToolRenderComponent,
    CalculatorToolRenderComponent,
    WildcardToolRenderComponent
  ],
  providers: [
    CopilotKit,
    provideCopilotKit({
      renderToolCalls: [
        {
          name: 'search',
          render: SearchToolRenderComponent
        },
        {
          name: 'calculator',
          render: CalculatorToolRenderComponent
        },
        {
          name: '*',
          render: WildcardToolRenderComponent
        }
      ]
    })
  ],
  template: \`
    <copilot-chat-message-view
      [messages]="messages">
    </copilot-chat-message-view>
  \`
})
export class ChatComponent {
  messages: Message[] = [
    {
      id: 'user-1',
      content: 'Search for React hooks documentation, calculate 42 * 17 and 100 / 4 + 75, and check the weather in San Francisco',
      role: 'user',
    },
    {
      id: 'assistant-1',
      content: 'I\\'ll help you search for React hooks documentation, calculate both expressions, and check the weather.',
      role: 'assistant',
      toolCalls: [
        {
          id: 'search-1',
          type: 'function',
          function: {
            name: 'search',
            arguments: JSON.stringify({
              query: 'React hooks documentation',
              filters: ['official', 'latest'],
            }),
          },
        },
        {
          id: 'calc-1',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({
              expression: '42 * 17',
            }),
          },
        },
        {
          id: 'calc-2',
          type: 'function',
          function: {
            name: 'calculator',
            arguments: JSON.stringify({
              expression: '100 / 4 + 75',
            }),
          },
        },
        {
          id: 'weather-1',
          type: 'function',
          function: {
            name: 'getWeather',
            arguments: '{"location": "San Francisco", "units": "fahren', // Intentionally cut off mid-word
          },
        },
      ],
    },
    {
      id: 'tool-search-1',
      role: 'tool',
      toolCallId: 'search-1',
      content: 'Found 5 relevant documentation pages about React hooks including useState, useEffect, and custom hooks.',
    },
    {
      id: 'tool-calc-1',
      role: 'tool',
      toolCallId: 'calc-1',
      content: '714',
    },
    {
      id: 'tool-calc-2',
      role: 'tool',
      toolCallId: 'calc-2',
      content: '100',
    },
    {
      id: 'tool-weather-1',
      role: 'tool',
      toolCallId: 'weather-1',
      content: 'Current weather in San Francisco: 68°F, partly cloudy with a gentle breeze.',
    },
  ];
}`,
        language: "typescript",
      },
    },
  },
  decorators: [
    moduleMetadata({
      imports: [
        CommonModule,
        CopilotChatMessageView,
        SearchToolRenderComponent,
        CalculatorToolRenderComponent,
        WildcardToolRenderComponent,
      ],
      providers: [
        CopilotKit,
        provideCopilotKit({
          runtimeUrl: undefined, // Explicitly provide undefined to avoid null injector error
          renderToolCalls: renderToolCallConfigs,
        }),
        provideCopilotChatLabels({
          assistantMessageToolbarCopyMessageLabel: "Copy",
          assistantMessageToolbarCopyCodeLabel: "Copy",
          assistantMessageToolbarCopyCodeCopiedLabel: "Copied",
          assistantMessageToolbarThumbsUpLabel: "Good response",
          assistantMessageToolbarThumbsDownLabel: "Bad response",
          assistantMessageToolbarReadAloudLabel: "Read aloud",
          assistantMessageToolbarRegenerateLabel: "Regenerate",
          userMessageToolbarCopyMessageLabel: "Copy",
          userMessageToolbarEditMessageLabel: "Edit",
        }),
      ],
    }),
  ],
  render: () => {
    const messages: Message[] = [
      {
        id: "user-1",
        content:
          "Search for React hooks documentation, calculate 42 * 17 and 100 / 4 + 75, and check the weather in San Francisco",
        role: "user" as const,
      },
      {
        id: "assistant-1",
        content: `I'll help you search for React hooks documentation, calculate both expressions, and check the weather.`,
        role: "assistant" as const,
        toolCalls: [
          {
            id: "search-1",
            type: "function" as const,
            function: {
              name: "search",
              arguments: JSON.stringify({
                query: "React hooks documentation",
                filters: ["official", "latest"],
              }),
            },
          },
          {
            id: "calc-1",
            type: "function" as const,
            function: {
              name: "calculator",
              arguments: JSON.stringify({
                expression: "42 * 17",
              }),
            },
          },
          {
            id: "calc-2",
            type: "function" as const,
            function: {
              name: "calculator",
              arguments: JSON.stringify({
                expression: "100 / 4 + 75",
              }),
            },
          },
          {
            id: "weather-1",
            type: "function" as const,
            function: {
              name: "getWeather",
              arguments: '{"location": "San Francisco", "units": "fahren', // Intentionally cut off mid-word
            },
          },
        ],
      } as Message,
      {
        id: "tool-search-1",
        role: "tool" as const,
        toolCallId: "search-1",
        content:
          "Found 5 relevant documentation pages about React hooks including useState, useEffect, and custom hooks.",
      } as Message,
      {
        id: "tool-calc-1",
        role: "tool" as const,
        toolCallId: "calc-1",
        content: "714",
      } as Message,
      {
        id: "tool-calc-2",
        role: "tool" as const,
        toolCallId: "calc-2",
        content: "100",
      } as Message,
      {
        id: "tool-weather-1",
        role: "tool" as const,
        toolCallId: "weather-1",
        content:
          "Current weather in San Francisco: 68°F, partly cloudy with a gentle breeze.",
      } as Message,
    ];

    return {
      props: {
        messages,
      },
      template: `
        <div style="height: 100vh; margin: 0; padding: 0;">
          <copilot-chat-message-view
            [messages]="messages">
          </copilot-chat-message-view>
        </div>
      `,
    };
  },
};
