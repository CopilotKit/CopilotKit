import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CommonModule } from "@angular/common";
import {
  CopilotChatUserMessage,
  provideCopilotChatLabels,
} from "@copilotkit/angular";
import type { UserMessage } from "@ag-ui/client";

// Simple default message
const simpleMessage: UserMessage = {
  id: "simple-user-message",
  content: "Hello! Can you help me build an Angular component?",
  role: "user",
};

// Longer user message
const longMessage: UserMessage = {
  id: "long-user-message",
  content: `I need help with creating a complex Angular component that handles user authentication. Here are my requirements:

1. The component should have login and signup forms
2. It needs to integrate with Firebase Auth
3. Should handle form validation
4. Must be responsive and work on mobile
5. Include forgot password functionality
6. Support social login (Google, GitHub)

Can you help me implement this step by step? I'm particularly struggling with the form validation and state management parts.`,
  role: "user",
};

// Code-related user message
const codeMessage: UserMessage = {
  id: "code-user-message",
  content: `I'm getting this error in my Angular app:

TypeError: Cannot read property 'map' of undefined

The error happens in this component:

@Component({
  selector: 'app-user-list',
  template: \`
    <div *ngFor="let user of users">
      {{ user.name }}
    </div>
  \`
})
export class UserListComponent {
  @Input() users: User[];
}

How can I fix this?`,
  role: "user",
};

// Short question
const shortMessage: UserMessage = {
  id: "short-user-message",
  content: "What's the difference between signals and observables in Angular?",
  role: "user",
};

const meta: Meta<CopilotChatUserMessage> = {
  title: "UI/CopilotChatUserMessage",
  component: CopilotChatUserMessage,
  decorators: [
    moduleMetadata({
      imports: [CommonModule, CopilotChatUserMessage],
      providers: [provideCopilotChatLabels({})],
    }),
  ],
  render: (args) => ({
    props: {
      ...args,
    },
    template: `
      <div style="display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-user-message
            [message]="message"
            [branchIndex]="branchIndex"
            [numberOfBranches]="numberOfBranches"
            [inputClass]="inputClass"
            [additionalToolbarItems]="additionalToolbarItems"
            (editMessage)="editMessage && editMessage($event)"
            (switchToBranch)="switchToBranch && switchToBranch($event)"
          ></copilot-chat-user-message>
        </div>
      </div>
    `,
  }),
  args: {
    message: simpleMessage,
    editMessage: () => console.log("Edit clicked!"),
  },
};

export default meta;
type Story = StoryObj<CopilotChatUserMessage>;

export const Default: Story = {
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'user-1',
    content: 'Hello! Can you help me build an Angular component?',
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    console.log('Edit message:', event);
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const LongMessage: Story = {
  args: {
    message: longMessage,
  },
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'long-user-message',
    content: \`I need help with creating a complex Angular component that handles user authentication. Here are my requirements:

1. The component should have login and signup forms
2. It needs to integrate with Firebase Auth
3. Should handle form validation
4. Must be responsive and work on mobile
5. Include forgot password functionality
6. Support social login (Google, GitHub)

Can you help me implement this step by step? I'm particularly struggling with the form validation and state management parts.\`,
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    console.log('Edit message:', event);
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const WithEditButton: Story = {
  args: {
    message: simpleMessage,
    editMessage: () => alert("Edit message clicked!"),
  },
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'simple-user-message',
    content: 'Hello! Can you help me build an Angular component?',
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    alert('Edit message clicked!');
    console.log('Edit message:', event);
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const WithoutEditButton: Story = {
  args: {
    message: simpleMessage,
    editMessage: undefined,
  },
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'simple-user-message',
    content: 'Hello! Can you help me build an Angular component?',
    role: 'user',
    timestamp: new Date(),
  };

  // No edit handler - edit button won't appear
}`,
        language: "typescript",
      },
    },
  },
};

export const CodeRelatedMessage: Story = {
  args: {
    message: codeMessage,
    editMessage: () => alert("Edit code message clicked!"),
  },
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'code-user-message',
    content: \`I'm getting this error in my Angular app:

TypeError: Cannot read property 'map' of undefined

The error happens in this component:

@Component({
  selector: 'app-user-list',
  template: \\\`
    <div *ngFor="let user of users">
      {{ user.name }}
    </div>
  \\\`
})
export class UserListComponent {
  @Input() users: User[];
}

How can I fix this?\`,
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    alert('Edit code message clicked!');
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const ShortQuestion: Story = {
  args: {
    message: shortMessage,
    editMessage: () => console.log("Edit short message clicked!"),
  },
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <copilot-chat-user-message
      [message]="message"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  message: UserMessage = {
    id: 'short-user-message',
    content: "What's the difference between signals and observables in Angular?",
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    console.log('Edit short message clicked!');
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const WithAdditionalToolbarItems: Story = {
  render: () => ({
    props: {
      message: simpleMessage,
      editMessage: () => console.log("Edit clicked!"),
    },
    template: `
      <ng-template #additionalItems>
        <button
          class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:bg-gray-100 cpk:hover:bg-gray-200 cpk:flex cpk:items-center cpk:justify-center"
          (click)="alert('Custom button 1 clicked!')"
          title="Custom Action 1">
          📎
        </button>
        <button
          class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:bg-gray-100 cpk:hover:bg-gray-200 cpk:flex cpk:items-center cpk:justify-center"
          (click)="alert('Custom button 2 clicked!')"
          title="Custom Action 2">
          🔄
        </button>
      </ng-template>

      <div style="display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-user-message
            [message]="message"
            [additionalToolbarItems]="additionalItems"
            (editMessage)="editMessage($event)"
          ></copilot-chat-user-message>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      source: {
        type: "code",
        code: `import { Component, ViewChild, TemplateRef } from '@angular/core';
import { CopilotChatUserMessage, UserMessage } from '@copilotkit/angular';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CopilotChatUserMessage],
  template: \`
    <ng-template #additionalItems>
      <button
        class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:bg-gray-100 cpk:hover:bg-gray-200 cpk:flex cpk:items-center cpk:justify-center"
        (click)="onCustomAction1()"
        title="Custom Action 1">
        📎
      </button>
      <button
        class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:bg-gray-100 cpk:hover:bg-gray-200 cpk:flex cpk:items-center cpk:justify-center"
        (click)="onCustomAction2()"
        title="Custom Action 2">
        🔄
      </button>
    </ng-template>

    <copilot-chat-user-message
      [message]="message"
      [additionalToolbarItems]="additionalItems"
      (editMessage)="onEditMessage($event)">
    </copilot-chat-user-message>
  \`
})
export class ChatComponent {
  @ViewChild('additionalItems') additionalItems!: TemplateRef<any>;

  message: UserMessage = {
    id: 'simple-user-message',
    content: 'Hello! Can you help me build an Angular component?',
    role: 'user',
    timestamp: new Date(),
  };

  onEditMessage(event: any): void {
    console.log('Edit clicked!');
  }

  onCustomAction1(): void {
    alert('Custom button 1 clicked!');
  }

  onCustomAction2(): void {
    alert('Custom button 2 clicked!');
  }
}`,
        language: "typescript",
      },
    },
  },
};

export const CustomAppearance: Story = {
  args: {
    message: simpleMessage,
    editMessage: () => console.log("Edit clicked!"),
    inputClass:
      "cpk:bg-blue-50 cpk:border cpk:border-blue-200 cpk:rounded-lg cpk:p-4",
  },
  render: () => ({
    props: {
      message: simpleMessage,
      editMessage: () => console.log("Edit clicked!"),
    },
    template: `
      <ng-template #messageRenderer let-content="content">
        <div class="cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3 cpk:inline-block cpk:whitespace-pre-wrap cpk:text-blue-900 cpk:font-medium">
          {{ content }}
        </div>
      </ng-template>

      <ng-template #toolbar>
        <div class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-[5px] cpk:mt-[8px] cpk:invisible cpk:group-hover:visible">
          <div class="cpk:flex cpk:items-center cpk:gap-1 cpk:justify-end">
            <button
              class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:text-blue-600 cpk:hover:bg-blue-100 cpk:flex cpk:items-center cpk:justify-center"
              (click)="handleCopy()">
              📋
            </button>
            <button
              class="cpk:h-8 cpk:w-8 cpk:p-0 cpk:rounded-md cpk:text-blue-600 cpk:hover:bg-blue-100 cpk:flex cpk:items-center cpk:justify-center"
              (click)="editMessage({message: message})">
              ✏️
            </button>
          </div>
        </div>
      </ng-template>

      <div style="display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-user-message
            [message]="message"
            inputClass="cpk:bg-blue-50 cpk:border-blue-200 cpk:rounded-lg cpk:p-4"
            (editMessage)="editMessage($event)">
            <ng-template #messageRenderer let-content="content">
              <div class="cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3 cpk:inline-block cpk:whitespace-pre-wrap cpk:text-blue-900 cpk:font-medium">
                {{ content }}
              </div>
            </ng-template>
          </copilot-chat-user-message>
        </div>
      </div>
    `,
  }),
};

export const CustomComponents: Story = {
  args: {
    message: simpleMessage,
    editMessage: () => console.log("Edit clicked!"),
    inputClass:
      "cpk:bg-gradient-to-r cpk:from-purple-100 cpk:to-pink-100 cpk:rounded-xl cpk:p-4 cpk:shadow-sm",
  },
  render: () => ({
    props: {
      message: simpleMessage,
      editMessage: () => console.log("Edit clicked!"),
    },
    template: `
      <ng-template #messageRenderer let-content="content">
        <div class="cpk:font-mono cpk:text-purple-800 cpk:bg-white/50 cpk:rounded-lg cpk:px-3 cpk:py-2 cpk:inline-block">
          💬 {{ content }}
        </div>
      </ng-template>

      <div style="display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px;">
        <div style="width: 100%; max-width: 640px;">
          <copilot-chat-user-message
            [message]="message"
            inputClass="cpk:bg-gradient-to-r cpk:from-purple-100 cpk:to-pink-100 cpk:rounded-xl cpk:p-4 cpk:shadow-sm"
            (editMessage)="editMessage($event)">
            <ng-template #messageRenderer let-content="content">
              <div class="cpk:font-mono cpk:text-purple-800 cpk:bg-white/50 cpk:rounded-lg cpk:px-3 cpk:py-2 cpk:inline-block">
                💬 {{ content }}
              </div>
            </ng-template>
          </copilot-chat-user-message>
        </div>
      </div>
    `,
  }),
};

export const WithBranchNavigation: Story = {
  args: {
    message: {
      id: "branch-message",
      content:
        "This message has multiple branches. You can navigate between them using the branch controls.",
      role: "user",
    },
    editMessage: () => console.log("Edit clicked!"),
    branchIndex: 2,
    numberOfBranches: 3,
    switchToBranch: ({ branchIndex }) =>
      console.log(`Switching to branch ${branchIndex + 1}`),
  },
};

export const WithManyBranches: Story = {
  args: {
    message: {
      id: "many-branches-message",
      content:
        "This is branch 5 of 10. Use the navigation arrows to explore different variations of this message.",
      role: "user",
    },
    editMessage: () => console.log("Edit clicked!"),
    branchIndex: 4,
    numberOfBranches: 10,
    switchToBranch: ({ branchIndex }) =>
      alert(`Would switch to branch ${branchIndex + 1} of 10`),
  },
};
