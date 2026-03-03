import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { fn } from "@storybook/test";
import {
  CopilotChatInput,
  provideCopilotChatLabels,
  type ToolsMenuItem,
} from "@copilotkitnext/angular";
import { CustomSendButtonComponent } from "../components/custom-send-button.component";

// Additional custom button components for slot demonstrations
@Component({
  selector: "airplane-send-button",
  standalone: true,
  template: `
    <button
      [disabled]="disabled"
      (click)="handleClick()"
      class="rounded-full w-10 h-10 bg-blue-500 text-white hover:bg-blue-600 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Send message"
    >
      ✈️
    </button>
  `,
})
class AirplaneSendButtonComponent {
  @Input() disabled = false;
  @Output() click = new EventEmitter<void>();

  handleClick(): void {
    if (!this.disabled) {
      this.click.emit();
    }
  }
}

@Component({
  selector: "rocket-send-button",
  standalone: true,
  template: `
    <button
      [disabled]="disabled"
      (click)="handleClick()"
      class="rounded-full w-10 h-10 bg-green-500 text-white hover:bg-green-600 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Send message"
    >
      🚀
    </button>
  `,
})
class RocketSendButtonComponent {
  @Input() disabled = false;
  @Output() click = new EventEmitter<void>();

  handleClick(): void {
    if (!this.disabled) {
      this.click.emit();
    }
  }
}

const meta: Meta<CopilotChatInput> = {
  title: "UI/CopilotChatInput",
  component: CopilotChatInput,
  tags: ["autodocs"],
  decorators: [
    moduleMetadata({
      imports: [
        CommonModule,
        CopilotChatInput,
        CustomSendButtonComponent,
        AirplaneSendButtonComponent,
        RocketSendButtonComponent,
      ],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
          chatInputToolbarToolsButtonLabel: "Tools",
        }),
      ],
    }),
  ],
  render: (args) => ({
    props: {
      ...args,
      submitMessage: fn(),
      startTranscribe: fn(),
      cancelTranscribe: fn(),
      finishTranscribe: fn(),
      addFile: fn(),
      valueChange: fn(),
    },
    template: `
      <div style="position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-input
            [mode]="mode"
            [inputClass]="inputClass"
            [toolsMenu]="toolsMenu"
            [value]="value"
            [autoFocus]="autoFocus"
            [sendButtonComponent]="sendButtonComponent"
            [additionalToolbarItems]="additionalToolbarItems"
            (submitMessage)="submitMessage($event)"
            (startTranscribe)="startTranscribe()"
            (cancelTranscribe)="cancelTranscribe()"
            (finishTranscribe)="finishTranscribe()"
            (addFile)="addFile()"
            (valueChange)="valueChange($event)"
          ></copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
The CopilotChatInput component provides a feature-rich chat input interface for Angular applications.

## Features
- 📝 Auto-resizing textarea with configurable max rows
- 🎙️ Voice recording mode with visual feedback
- 🛠️ Customizable tools dropdown menu
- 📎 File attachment support
- 🎨 Dark/light theme support
- 🔧 Fully customizable via slots and props
- ♿ Accessible with ARIA labels and keyboard navigation

## Basic Usage

\`\`\`typescript
import { CopilotChatInput } from '@copilotkitnext/angular';
import { provideCopilotChatLabels } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: 'Type a message...',
    })
  ],
  template: \`
    <copilot-chat-input
      (submitMessage)="onSubmitMessage($event)"
    ></copilot-chat-input>
  \`
})
export class ChatComponent {
  onSubmitMessage(message: string): void {
    console.log('Message:', message);
  }
}
\`\`\`

## Customization

The component supports extensive customization through:
- **Props**: Configure behavior and appearance
- **Slots**: Replace default UI elements with custom components
- **Templates**: Use ng-template for fine-grained control
- **Styling**: Apply custom CSS classes

See individual stories below for detailed examples of each customization approach.
        `,
      },
    },
  },
  argTypes: {
    mode: {
      control: { type: "radio" },
      options: ["input", "transcribe"],
      description: "The input mode - text input or voice recording",
      table: {
        type: { summary: "'input' | 'transcribe'" },
        defaultValue: { summary: "input" },
        category: "Behavior",
      },
    },
    inputClass: {
      control: { type: "text" },
      description: "Custom CSS class for styling the input container",
      table: {
        type: { summary: "string" },
        defaultValue: { summary: "" },
        category: "Appearance",
      },
    },
    value: {
      control: { type: "text" },
      description: "The current input value (for controlled components)",
      table: {
        type: { summary: "string" },
        defaultValue: { summary: "" },
        category: "Data",
      },
    },
    autoFocus: {
      control: { type: "boolean" },
      description: "Auto-focus the input when the component mounts",
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "true" },
        category: "Behavior",
      },
    },
    toolsMenu: {
      description: "Array of menu items for the tools dropdown",
      table: {
        type: { summary: '(ToolsMenuItem | "-")[]' },
        category: "Features",
      },
    },
    sendButtonComponent: {
      description: "Custom send button component",
      table: {
        type: { summary: "Type<any>" },
        category: "Customization",
      },
    },
    additionalToolbarItems: {
      description: "Additional toolbar items to display",
      table: {
        type: { summary: "TemplateRef | Component[]" },
        category: "Customization",
      },
    },
  },
  args: {
    mode: "input",
    inputClass: "",
    value: "",
    autoFocus: true,
  },
};

export default meta;
type Story = StoryObj<CopilotChatInput>;

// 1. Default story
export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: "The default chat input with all standard features enabled.",
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput, provideCopilotChatLabels } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  providers: [
    provideCopilotChatLabels({
      chatInputPlaceholder: 'Type a message...',
    })
  ],
  template: \`
    <copilot-chat-input
      (submitMessage)="onSubmitMessage($event)"
      (valueChange)="onValueChange($event)"
      (addFile)="onAddFile()"
      (startTranscribe)="onStartTranscribe()"
      (cancelTranscribe)="onCancelTranscribe()"
      (finishTranscribe)="onFinishTranscribe()">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
  
  onValueChange(value: string): void {
    console.log('Value changed:', value);
  }
  
  onAddFile(): void {
    console.log('Add file clicked');
  }
  
  onStartTranscribe(): void {
    console.log('Started transcription');
  }
  
  onCancelTranscribe(): void {
    console.log('Cancelled transcription');
  }
  
  onFinishTranscribe(): void {
    console.log('Finished transcription');
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 2. With Tools Menu
export const WithToolsMenu: Story = {
  name: "With Tools Menu",
  args: {
    toolsMenu: [
      {
        label: "Do X",
        action: () => {
          console.log("Do X clicked");
          alert("Action: Do X was clicked!");
        },
      },
      {
        label: "Do Y",
        action: () => {
          console.log("Do Y clicked");
          alert("Action: Do Y was clicked!");
        },
      },
      "-",
      {
        label: "Advanced",
        items: [
          {
            label: "Do Advanced X",
            action: () => {
              console.log("Do Advanced X clicked");
              alert("Advanced Action: Do Advanced X was clicked!");
            },
          },
          "-",
          {
            label: "Do Advanced Y",
            action: () => {
              console.log("Do Advanced Y clicked");
              alert("Advanced Action: Do Advanced Y was clicked!");
            },
          },
        ],
      },
    ] as (ToolsMenuItem | "-")[],
  },
  parameters: {
    docs: {
      description: {
        story: `
Demonstrates a tools dropdown menu with nested items and separators.

\`\`\`typescript
toolsMenu: [
  { label: 'Action 1', action: () => {} },
  '-', // Separator
  { 
    label: 'Submenu',
    items: [
      { label: 'Sub Action', action: () => {} }
    ]
  }
]
\`\`\`
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput, ToolsMenuItem } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      [toolsMenu]="toolsMenu"
      (submitMessage)="onSubmitMessage($event)">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  toolsMenu: (ToolsMenuItem | '-')[] = [
    {
      label: 'Do X',
      action: () => {
        console.log('Do X clicked');
        alert('Action: Do X was clicked!');
      },
    },
    {
      label: 'Do Y',
      action: () => {
        console.log('Do Y clicked');
        alert('Action: Do Y was clicked!');
      },
    },
    '-', // Separator
    {
      label: 'Advanced',
      items: [
        {
          label: 'Do Advanced X',
          action: () => {
            console.log('Do Advanced X clicked');
            alert('Advanced Action: Do Advanced X was clicked!');
          },
        },
        '-',
        {
          label: 'Do Advanced Y',
          action: () => {
            console.log('Do Advanced Y clicked');
            alert('Advanced Action: Do Advanced Y was clicked!');
          },
        },
      ],
    },
  ];
  
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 3. Transcribe Mode
export const TranscribeMode: Story = {
  name: "Transcribe Mode",
  args: {
    mode: "transcribe",
    autoFocus: false,
  },
  parameters: {
    docs: {
      description: {
        story: `
Voice recording mode with animated waveform visualization.

\`\`\`html
<copilot-chat-input mode="transcribe"></copilot-chat-input>
\`\`\`

Emits:
- \`(startTranscribe)\` - Recording started
- \`(cancelTranscribe)\` - Recording cancelled
- \`(finishTranscribe)\` - Recording completed
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      mode="transcribe"
      [autoFocus]="false"
      (startTranscribe)="onStartTranscribe()"
      (cancelTranscribe)="onCancelTranscribe()"
      (finishTranscribe)="onFinishTranscribe()">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  onStartTranscribe(): void {
    console.log('Recording started');
  }
  
  onCancelTranscribe(): void {
    console.log('Recording cancelled');
  }
  
  onFinishTranscribe(): void {
    console.log('Recording finished');
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 4. Custom Send Button
export const CustomSendButton: Story = {
  name: "Custom Send Button (Template Slot)",
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatInput, CustomSendButtonComponent],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
          chatInputToolbarToolsButtonLabel: "Tools",
        }),
      ],
    }),
  ],
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
    },
    template: `
      <div style="position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-input
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
            <ng-template #sendButton let-send="send" let-disabled="disabled">
              <custom-send-button 
                [disabled]="disabled" 
                (click)="send()">
              </custom-send-button>
            </ng-template>
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Replace the default send button using Angular's template slot system.

\`\`\`html
<copilot-chat-input>
  <ng-template #sendButton let-send="send" let-disabled="disabled">
    <custom-send-button 
      [disabled]="disabled" 
      (click)="send()">
    </custom-send-button>
  </ng-template>
</copilot-chat-input>
\`\`\`

The template receives:
- \`send\`: Function to trigger message submission
- \`disabled\`: Boolean indicating if sending is allowed
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

// Custom send button component
@Component({
  selector: 'custom-send-button',
  standalone: true,
  template: \`
    <button
      [disabled]="disabled"
      (click)="handleClick()"
      class="rounded-full w-10 h-10 bg-purple-500 text-white hover:bg-purple-600 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Send message">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="w-5 h-5 mx-auto">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    </button>
  \`,
})
export class CustomSendButtonComponent {
  @Input() disabled = false;
  @Output() click = new EventEmitter<void>();
  
  handleClick(): void {
    if (!this.disabled) {
      this.click.emit();
    }
  }
}

// Main component using the custom send button
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput, CustomSendButtonComponent],
  template: \`
    <copilot-chat-input
      (submitMessage)="onSubmitMessage($event)">
      <ng-template #sendButton let-send="send" let-disabled="disabled">
        <custom-send-button 
          [disabled]="disabled" 
          (click)="send()">
        </custom-send-button>
      </ng-template>
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 5. With Additional Toolbar Items
export const WithAdditionalToolbarItems: Story = {
  name: "With Additional Toolbar Items",
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
      onCustomAction: () => {
        console.log("Custom action clicked!");
        alert("Custom action clicked!");
      },
      onAnotherAction: () => {
        console.log("Another custom action clicked!");
        alert("Another custom action clicked!");
      },
    },
    template: `
      <ng-template #additionalItems>
        <button
          class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center ml-2"
          (click)="onCustomAction()"
          title="Custom Action"
          style="height: 32px; width: 32px; padding: 0; border-radius: 6px; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; margin-left: 8px; border: none; cursor: pointer;"
          onmouseover="this.style.backgroundColor='#e5e7eb'"
          onmouseout="this.style.backgroundColor='#f3f4f6'"
        >
          ⭐
        </button>
        <button
          class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center ml-1"
          (click)="onAnotherAction()"
          title="Another Custom Action"
          style="height: 32px; width: 32px; padding: 0; border-radius: 6px; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; margin-left: 4px; border: none; cursor: pointer;"
          onmouseover="this.style.backgroundColor='#e5e7eb'"
          onmouseout="this.style.backgroundColor='#f3f4f6'"
        >
          🔖
        </button>
      </ng-template>
      
      <div style="position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-input
            [additionalToolbarItems]="additionalItems"
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Add custom toolbar items alongside the default tools.

\`\`\`html
<ng-template #additionalItems>
  <button class="custom-toolbar-btn" (click)="onAction()">⭐</button>
  <button class="custom-toolbar-btn" (click)="onAction2()">🔖</button>
</ng-template>

<copilot-chat-input 
  [additionalToolbarItems]="additionalItems">
</copilot-chat-input>
\`\`\`

These items appear in the toolbar area next to the default buttons.
Note: The template is passed as an input property, not as content projection.
        `,
      },
      source: {
        type: "code",
        code: `import { Component, ViewChild, TemplateRef } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <ng-template #additionalItems>
      <button
        class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center ml-2"
        (click)="onCustomAction()"
        title="Custom Action">
        ⭐
      </button>
      <button
        class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center ml-1"
        (click)="onAnotherAction()"
        title="Another Custom Action">
        🔖
      </button>
    </ng-template>
    
    <copilot-chat-input
      [additionalToolbarItems]="additionalItems"
      (submitMessage)="onSubmitMessage($event)"
      (addFile)="onAddFile()">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  @ViewChild('additionalItems') additionalItems!: TemplateRef<any>;
  
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
  
  onAddFile(): void {
    console.log('Add file clicked');
  }
  
  onCustomAction(): void {
    console.log('Custom action clicked!');
    alert('Custom action clicked!');
  }
  
  onAnotherAction(): void {
    console.log('Another custom action clicked!');
    alert('Another custom action clicked!');
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 6. Prefilled Text
export const PrefilledText: Story = {
  name: "Prefilled Text",
  args: {
    value: "Hello, this is a prefilled message!",
  },
  parameters: {
    docs: {
      description: {
        story: `
Initialize the input with pre-populated text.

\`\`\`html
<copilot-chat-input 
  [value]="initialMessage"
  (valueChange)="onValueChange($event)">
</copilot-chat-input>
\`\`\`

Useful for:
- Draft messages
- Edit mode
- Template messages
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      [value]="initialMessage"
      (valueChange)="onValueChange($event)"
      (submitMessage)="onSubmitMessage($event)">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  initialMessage = 'Hello, this is a prefilled message!';
  
  onValueChange(value: string): void {
    console.log('Value changed:', value);
  }
  
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 7. Expanded Textarea
export const ExpandedTextarea: Story = {
  name: "Expanded Textarea",
  args: {
    value:
      "This is a longer message that will cause the textarea to expand.\n\nIt has multiple lines to demonstrate the auto-resize functionality.\n\nThe textarea will grow up to the maxRows limit.",
  },
  parameters: {
    docs: {
      description: {
        story: `
Demonstrates auto-expanding textarea behavior with multiline content.

The textarea automatically resizes based on content, up to a configurable maximum height.
Features:
- Smooth expansion animation
- Maintains scroll position
- Respects maxRows configuration
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      [value]="multilineMessage"
      (valueChange)="onValueChange($event)"
      (submitMessage)="onSubmitMessage($event)">
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  multilineMessage = 
    'This is a longer message that will cause the textarea to expand.\\n\\n' +
    'It has multiple lines to demonstrate the auto-resize functionality.\\n\\n' +
    'The textarea will grow up to the maxRows limit.';
  
  onValueChange(value: string): void {
    console.log('Value changed:', value);
  }
  
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

// 8. Custom Styling
export const CustomStyling: Story = {
  name: "Custom Styling",
  render: (args) => ({
    props: {
      ...args,
      submitMessage: fn(),
      startTranscribe: fn(),
      cancelTranscribe: fn(),
      finishTranscribe: fn(),
      addFile: fn(),
      valueChange: fn(),
    },
    template: `
      <style>
        .custom-chat-input {
          border: 2px solid #4f46e5 !important;
          border-radius: 12px !important;
          background: linear-gradient(to right, #f3f4f6, #ffffff) !important;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important;
          padding: 12px !important;
        }
        
        .custom-chat-input textarea {
          font-family: 'Monaco', 'Consolas', monospace !important;
          font-size: 14px !important;
          color: #1e293b !important;
        }
        
        .custom-chat-input button {
          transition: all 0.3s ease !important;
        }
        
        .custom-chat-input button:hover {
          transform: scale(1.05) !important;
        }
      </style>
      <div style="position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-input
            [mode]="mode"
            [inputClass]="'custom-chat-input'"
            [toolsMenu]="toolsMenu"
            [value]="value"
            [autoFocus]="autoFocus"
            (submitMessage)="submitMessage($event)"
            (startTranscribe)="startTranscribe()"
            (cancelTranscribe)="cancelTranscribe()"
            (finishTranscribe)="finishTranscribe()"
            (addFile)="addFile()"
            (valueChange)="valueChange($event)"
          ></copilot-chat-input>
        </div>
      </div>
    `,
  }),
  args: {
    inputClass: "custom-chat-input",
  },
  parameters: {
    docs: {
      description: {
        story: `
Apply custom CSS classes for unique styling. This example demonstrates inline styles that override default component styling.

\`\`\`html
<!-- Add styles to your component or global CSS -->
<style>
  .custom-chat-input {
    border: 2px solid #4f46e5;
    border-radius: 12px;
    background: linear-gradient(to right, #f3f4f6, #ffffff);
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  }
</style>

<!-- Use the custom class -->
<copilot-chat-input 
  inputClass="custom-chat-input">
</copilot-chat-input>
\`\`\`

This example shows:
- Custom border and background styling
- Modified typography for the textarea
- Hover effects on buttons
- Box shadow for depth
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      inputClass="custom-chat-input"
      (submitMessage)="onSubmitMessage($event)">
    </copilot-chat-input>
  \`,
  styles: [\`
    :host ::ng-deep .custom-chat-input {
      border: 2px solid #4f46e5 !important;
      border-radius: 12px !important;
      background: linear-gradient(to right, #f3f4f6, #ffffff) !important;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important;
      padding: 12px !important;
    }
    
    :host ::ng-deep .custom-chat-input textarea {
      font-family: 'Monaco', 'Consolas', monospace !important;
      font-size: 14px !important;
      color: #1e293b !important;
    }
    
    :host ::ng-deep .custom-chat-input button {
      transition: all 0.3s ease !important;
    }
    
    :host ::ng-deep .custom-chat-input button:hover {
      transform: scale(1.05) !important;
    }
  \`]
})
export class ChatComponent {
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

// === SLOT CUSTOMIZATION EXAMPLES ===
// The following stories demonstrate Angular's powerful slot system for component customization

export const SlotTemplateFullControl: Story = {
  name: "Slot: Template with Full Control",
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
    },
    template: `
      <div style="padding: 20px; background: #f5f5f5;">
        <h3 style="margin-bottom: 10px;">Use ng-template for complete control over the send button:</h3>
        <pre style="background: #282c34; color: #abb2bf; padding: 10px; border-radius: 4px; font-size: 12px;">
&lt;copilot-chat-input&gt;
  &lt;ng-template #sendButton let-send="send" let-disabled="disabled"&gt;
    &lt;button (click)="send()" [disabled]="disabled"
            class="custom-gradient-button"&gt;
      Send 🎯
    &lt;/button&gt;
  &lt;/ng-template&gt;
&lt;/copilot-chat-input&gt;</pre>
        
        <div style="margin-top: 20px;">
          <copilot-chat-input
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
            <ng-template #sendButton let-send="send" let-disabled="disabled">
              <button 
                (click)="send()" 
                [disabled]="disabled"
                class="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 transition-all">
                Send 🎯
              </button>
            </ng-template>
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
The most flexible approach - use ng-template to completely control the send button's markup and behavior.

**Benefits:**
- Full control over HTML structure
- Direct access to template variables
- Can use any Angular directives
- Perfect for complex custom components
        `,
      },
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatInput } from '@copilotkitnext/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatInput],
  template: \`
    <copilot-chat-input
      (submitMessage)="onSubmitMessage($event)">
      <ng-template #sendButton let-send="send" let-disabled="disabled">
        <button 
          (click)="send()" 
          [disabled]="disabled"
          class="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 transition-all">
          Send 🎯
        </button>
      </ng-template>
    </copilot-chat-input>
  \`
})
export class ChatComponent {
  onSubmitMessage(message: string): void {
    console.log('Message submitted:', message);
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const SlotInlineButton: Story = {
  name: "Slot: Inline Custom Button",
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatInput, AirplaneSendButtonComponent],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
        }),
      ],
    }),
  ],
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
    },
    template: `
      <div style="padding: 20px; background: #f5f5f5;">
        <h3 style="margin-bottom: 10px;">Define custom button markup inline:</h3>
        <pre style="background: #282c34; color: #abb2bf; padding: 10px; border-radius: 4px; font-size: 12px;">
&lt;copilot-chat-input&gt;
  &lt;ng-template #sendButton let-send="send" let-disabled="disabled"&gt;
    &lt;button [disabled]="disabled" (click)="send()"
            class="airplane-button"&gt;
      ✈️
    &lt;/button&gt;
  &lt;/ng-template&gt;
&lt;/copilot-chat-input&gt;</pre>
        
        <div style="margin-top: 20px;">
          <copilot-chat-input
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
            <ng-template #sendButton let-send="send" let-disabled="disabled">
              <button 
                [disabled]="disabled" 
                (click)="send()"
                class="rounded-full w-10 h-10 bg-blue-500 text-white hover:bg-blue-600 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed">
                ✈️
              </button>
            </ng-template>
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Create a custom button directly in the template without a separate component.

**When to use:**
- Simple customizations
- One-off designs
- Prototyping
- When you don't need reusability
        `,
      },
    },
  },
};

export const SlotWithComponent: Story = {
  name: "Slot: Using Custom Component",
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatInput, RocketSendButtonComponent],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
        }),
      ],
    }),
  ],
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
    },
    template: `
      <div style="padding: 20px; background: #f5f5f5;">
        <h3 style="margin-bottom: 10px;">Use a pre-built component in the slot:</h3>
        <pre style="background: #282c34; color: #abb2bf; padding: 10px; border-radius: 4px; font-size: 12px;">
&lt;copilot-chat-input&gt;
  &lt;ng-template #sendButton let-send="send" let-disabled="disabled"&gt;
    &lt;rocket-send-button 
      [disabled]="disabled" 
      (click)="send()"&gt;
    &lt;/rocket-send-button&gt;
  &lt;/ng-template&gt;
&lt;/copilot-chat-input&gt;</pre>
        
        <div style="margin-top: 20px;">
          <copilot-chat-input
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
            <ng-template #sendButton let-send="send" let-disabled="disabled">
              <rocket-send-button 
                [disabled]="disabled" 
                (click)="send()">
              </rocket-send-button>
            </ng-template>
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Use a standalone Angular component within the template slot.

**Benefits:**
- Reusable across multiple places
- Encapsulated logic and styling
- Easier testing
- Better code organization

**Component requirements:**
- Must accept \`disabled\` input
- Should emit \`clicked\` (preferred) or \`click\` event
- Should be standalone or properly imported
        `,
      },
    },
  },
};

export const SlotDirectComponent: Story = {
  name: "Slot: Direct Component",
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatInput, RocketSendButtonComponent],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
        }),
      ],
    }),
  ],
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
      SendButton: RocketSendButtonComponent,
    },
    template: `
      <div style="padding: 20px; background: #f5f5f5;">
        <h3 style="margin-bottom: 10px;">Pass component class directly (backward compatible):</h3>
        <pre style="background: #282c34; color: #abb2bf; padding: 10px; border-radius: 4px; font-size: 12px;">
// In component:
SendButton = RocketSendButtonComponent;

// In template:
&lt;copilot-chat-input [sendButtonComponent]="SendButton"&gt;
&lt;/copilot-chat-input&gt;</pre>
        
        <div style="margin-top: 20px;">
          <copilot-chat-input
            [sendButtonComponent]="SendButton"
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Legacy approach for backward compatibility - pass a component class directly.

⚠️ **Note:** Template slots (ng-template) are preferred for better flexibility.

**Limitations:**
- Less flexible than templates
- Harder to pass custom props
- Component must match expected interface exactly
        `,
      },
    },
  },
};

export const SlotMultipleCustomizations: Story = {
  name: "Slot: Multiple Customizations",
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatInput, AirplaneSendButtonComponent],
      providers: [
        provideCopilotChatLabels({
          chatInputPlaceholder: "Type a message...",
        }),
      ],
    }),
  ],
  render: () => ({
    props: {
      submitMessage: fn(),
      addFile: fn(),
    },
    template: `
      <ng-template #additionalItems>
        <button 
          style="height: 32px; width: 32px; padding: 0; border-radius: 6px; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; margin-left: 4px; border: none; cursor: pointer;"
          title="Attach file"
          onmouseover="this.style.backgroundColor='#e5e7eb'"
          onmouseout="this.style.backgroundColor='#f3f4f6'">
          📎
        </button>
        <button 
          style="height: 32px; width: 32px; padding: 0; border-radius: 6px; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; margin-left: 4px; border: none; cursor: pointer;"
          title="Add emoji"
          onmouseover="this.style.backgroundColor='#e5e7eb'"
          onmouseout="this.style.backgroundColor='#f3f4f6'">
          😊
        </button>
      </ng-template>
      
      <div style="padding: 20px; background: #f5f5f5;">
        <h3 style="margin-bottom: 10px;">Combine multiple slot customizations:</h3>
        <pre style="background: #282c34; color: #abb2bf; padding: 10px; border-radius: 4px; font-size: 12px;">
&lt;ng-template #additionalItems&gt;
  &lt;button class="toolbar-btn"&gt;📎&lt;/button&gt;
  &lt;button class="toolbar-btn"&gt;😊&lt;/button&gt;
&lt;/ng-template&gt;

&lt;copilot-chat-input 
  [additionalToolbarItems]="additionalItems"&gt;
  &lt;ng-template #sendButton let-send="send" let-disabled="disabled"&gt;
    &lt;airplane-send-button [disabled]="disabled" (click)="send()"&gt;
    &lt;/airplane-send-button&gt;
  &lt;/ng-template&gt;
&lt;/copilot-chat-input&gt;</pre>
        
        <div style="margin-top: 20px;">
          <copilot-chat-input
            [additionalToolbarItems]="additionalItems"
            (submitMessage)="submitMessage($event)"
            (addFile)="addFile()">
            <ng-template #sendButton let-send="send" let-disabled="disabled">
              <airplane-send-button 
                [disabled]="disabled" 
                (click)="send()">
              </airplane-send-button>
            </ng-template>
          </copilot-chat-input>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: `
Customize multiple aspects of the component simultaneously using different slots.

**Available slots:**
- \`#sendButton\` - Replace the send button
- \`#additionalToolbarItems\` - Add extra toolbar buttons
- More slots coming soon!

Each slot operates independently, allowing for granular customization.
        `,
      },
    },
  },
};
