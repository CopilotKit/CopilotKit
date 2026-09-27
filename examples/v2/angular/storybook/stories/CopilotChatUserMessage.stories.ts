import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import type { UserMessage } from "@ag-ui/client";
import { CopilotChatUserMessage } from "@copilotkit/angular";
import { withMessageColumn } from "./support/layouts";

const simpleMessage: UserMessage = {
  id: "simple-user-message",
  content: "Hello! Can you help me build an Angular component?",
  role: "user",
};

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

const codeMessage: UserMessage = {
  id: "code-user-message",
  content: `I'm getting this error in my React app:

\`TypeError: Cannot read property 'map' of undefined\`

The error happens in this component:

\`\`\`jsx
function UserList({ users }) {
  return (
    <div>
      {users.map((user) => (
        <div key={user.id}>{user.name}</div>
      ))}
    </div>
  );
}
\`\`\`

How can I fix this? I've tried:
- adding a **default prop**
- checking \`users.length\` first`,
  role: "user",
};

const shortMessage: UserMessage = {
  id: "short-user-message",
  content: "What's the difference between signals and observables in Angular?",
  role: "user",
};

const log =
  (label: string) =>
  (...args: unknown[]) =>
    console.info(`[Storybook] ${label}`, ...args);

const meta: Meta<CopilotChatUserMessage> = {
  title: "UI/CopilotChatUserMessage",
  component: CopilotChatUserMessage,
  decorators: [
    moduleMetadata({ imports: [CopilotChatUserMessage] }),
    withMessageColumn,
  ],
  args: {
    message: simpleMessage,
    branchIndex: undefined,
    numberOfBranches: undefined,
    inputClass: undefined,
    toolbarClass: undefined,
  },
  render: (args) => ({
    props: {
      ...args,
      editMessage: log("editMessage"),
      switchToBranch: log("switchToBranch"),
    },
    template: `
      <copilot-chat-user-message
        [message]="message"
        [branchIndex]="branchIndex"
        [numberOfBranches]="numberOfBranches"
        [inputClass]="inputClass"
        [toolbarClass]="toolbarClass"
        (editMessage)="editMessage($event)"
        (switchToBranch)="switchToBranch($event)"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatUserMessage>;

export const Default: Story = {};

export const LongMessage: Story = {
  args: { message: longMessage },
};

/** The toolbar (copy + edit) is revealed on hover; pinned open here. */
export const WithEditButton: Story = {
  args: { toolbarClass: "story-toolbar-visible" },
};

/** An empty `#editButton` slot removes the edit action, leaving copy. */
export const WithoutEditButton: Story = {
  render: (args) => ({
    props: args,
    template: `
      <copilot-chat-user-message [message]="message" toolbarClass="story-toolbar-visible">
        <ng-template #editButton></ng-template>
      </copilot-chat-user-message>
    `,
  }),
};

export const CodeRelatedMessage: Story = {
  args: { message: codeMessage },
};

/**
 * User text renders as markdown (emphasis, links, lists, tables, code) while
 * line breaks stay as typed and \`#\` lines and pasted HTML stay literal.
 */
export const MarkdownFormatting: Story = {
  args: {
    message: {
      id: "markdown-user-message",
      role: "user",
      content: `# This stays a plain line, not a heading
Keep my line breaks
exactly as I typed them.

Can you compare **signal()** and *computed()* for [this form](https://angular.dev)?

1. \`signal\` for simple fields
2. \`computed\` for derived state

| API | Best for |
| --- | --- |
| signal | independent values |
| computed | derived values |

<b>Pasted HTML shows as text.</b>`,
    },
  },
};

export const ShortQuestion: Story = {
  args: { message: shortMessage },
};

export const WithAdditionalToolbarItems: Story = {
  render: (args) => ({
    props: { ...args, onAction: log("toolbar action") },
    template: `
      <ng-template #additionalItems>
        <button type="button" class="story-icon-button" title="Pin" (click)="onAction('pin')">📌</button>
        <button type="button" class="story-icon-button" title="Retry" (click)="onAction('retry')">↻</button>
      </ng-template>
      <copilot-chat-user-message
        [message]="message"
        toolbarClass="story-toolbar-visible"
        [additionalToolbarItems]="additionalItems"
      />
    `,
  }),
};

/** Host CSS applied to the bubble through `messageRendererClass`. */
export const CustomAppearance: Story = {
  render: (args) => ({
    props: args,
    template: `
      <copilot-chat-user-message
        [message]="message"
        messageRendererClass="story-branded-bubble"
      />
    `,
  }),
};

/** A custom `#messageRenderer` template replaces the default bubble. */
export const CustomComponents: Story = {
  render: (args) => ({
    props: args,
    template: `
      <copilot-chat-user-message [message]="message">
        <ng-template #messageRenderer let-content="content">
          <div class="story-branded-user-message">💬 {{ content }}</div>
        </ng-template>
      </copilot-chat-user-message>
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
    branchIndex: 1,
    numberOfBranches: 3,
    toolbarClass: "story-toolbar-visible",
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
    branchIndex: 4,
    numberOfBranches: 10,
    toolbarClass: "story-toolbar-visible",
  },
};
