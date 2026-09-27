import type { UserMessage } from "@ag-ui/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChatUserMessage } from "@copilotkit/vue";
import { withMessageColumn, withStyles } from "./support/layouts";

// Brand looks for the customization stories; each has a dark counterpart.
const CUSTOM_MESSAGE_CSS = `
  .demo-bubble {
    display: inline-block;
    max-width: 80%;
    border-radius: 18px;
    background: oklch(0.97 0.014 255);
    color: oklch(0.38 0.14 262);
    padding: 6px 16px;
    font-weight: 500;
    white-space: pre-wrap;
  }
  .dark .demo-bubble {
    background: oklch(0.3 0.06 262);
    color: oklch(0.9 0.04 255);
  }
  .demo-toolbar {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 8px;
  }
  .demo-toolbar .story-icon-button {
    color: oklch(0.55 0.2 262);
  }
  .dark .demo-toolbar .story-icon-button {
    color: oklch(0.78 0.12 255);
  }
  .demo-gradient {
    border-radius: 12px;
    background: linear-gradient(to right, oklch(0.95 0.03 305), oklch(0.95 0.03 350));
    padding: 16px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  }
  .dark .demo-gradient {
    background: linear-gradient(to right, oklch(0.3 0.06 305), oklch(0.3 0.06 350));
  }
  .demo-mono {
    display: inline-block;
    border-radius: 8px;
    background: color-mix(in oklch, var(--background) 55%, transparent);
    color: oklch(0.42 0.16 305);
    padding: 8px 12px;
    font-family: var(--story-mono);
  }
  .dark .demo-mono {
    color: oklch(0.88 0.06 305);
  }
  .demo-note {
    border-left: 4px solid oklch(0.8 0.16 85);
    background: oklch(0.98 0.03 95);
    color: oklch(0.3 0.03 85);
    padding: 16px;
  }
  .dark .demo-note {
    background: oklch(0.28 0.04 85);
    color: oklch(0.95 0.02 95);
  }
  .demo-note__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .demo-note__content { flex: 1; white-space: pre-wrap; }
  .demo-note__actions { display: flex; align-items: center; gap: 4px; }
  .demo-note__caption { margin-top: 8px; font-size: 12px; opacity: 0.75; }
`;

const handleEditMessage = (message: string) => () => window.alert(message);
const handleEditMessageLog = (message: string) => () => console.log(message);
const onCustomButton1 = () => window.alert("Custom button 1 clicked!");
const onCustomButton2 = () => window.alert("Custom button 2 clicked!");
const handleSwitchToBranch =
  (formatter: (branchIndex: number) => string) =>
  ({ branchIndex }: { branchIndex: number }) =>
    formatter(branchIndex);

const simpleMessage: UserMessage = {
  id: "simple-user-message",
  content: "Hello! Can you help me build a React component?",
  role: "user",
};

const longMessage: UserMessage = {
  id: "long-user-message",
  content: `I need help with creating a complex React component that handles user authentication. Here are my requirements:

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
  content: "What's the difference between useState and useReducer?",
  role: "user",
};

const meta = {
  title: "UI/CopilotChatUserMessage",
  component: CopilotChatUserMessage,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    message: simpleMessage,
  },
} satisfies Meta<typeof CopilotChatUserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongMessage: Story = {
  args: {
    message: longMessage,
  },
};

export const WithEditButton: Story = {
  args: { message: simpleMessage },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessage("Edit message clicked!"),
      };
    },
    template: `<CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage" />`,
  }),
};

export const WithoutEditButton: Story = {
  args: { message: simpleMessage },
};

export const CodeRelatedMessage: Story = {
  args: { message: codeMessage },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessage("Edit code message clicked!"),
      };
    },
    template: `<CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage" />`,
  }),
};

/**
 * User text renders as markdown: code, lists, emphasis, links and tables, while
 * line breaks stay where the user put them, and `#` lines and pasted HTML stay
 * literal.
 */
export const MarkdownFormatting: Story = {
  args: {
    message: {
      id: "markdown-user-message",
      role: "user",
      content: `# This stays a plain line, not a heading
Keep my line breaks
exactly as I typed them.

Can you compare **useState** and *useReducer* for [this form](https://react.dev)?

1. \`useState\` for simple fields
2. \`useReducer\` for related state

| Hook | Best for |
| --- | --- |
| useState | independent values |
| useReducer | complex transitions |

<b>Pasted HTML shows as text.</b>`,
    },
  },
};

export const ShortQuestion: Story = {
  args: { message: shortMessage },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessageLog("Edit short message clicked!"),
      };
    },
    template: `<CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage" />`,
  }),
};

export const WithAdditionalToolbarItems: Story = {
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return { args, onCustomButton1, onCustomButton2 };
    },
    template: `
      <CopilotChatUserMessage v-bind="args">
        <template #toolbar-items>
          <button
            type="button"
            class="story-icon-button"
            title="Custom Action 1"
            aria-label="Custom Action 1"
            @click="onCustomButton1"
          >
            📎
          </button>
          <button
            type="button"
            class="story-icon-button"
            title="Custom Action 2"
            aria-label="Custom Action 2"
            @click="onCustomButton2"
          >
            🔄
          </button>
        </template>
      </CopilotChatUserMessage>
    `,
  }),
};

export const CustomAppearance: Story = {
  decorators: [withStyles(CUSTOM_MESSAGE_CSS)],
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatUserMessage v-bind="args">
        <template #message-renderer="{ content }">
          <div class="demo-bubble">{{ content }}</div>
        </template>
        <template #toolbar="{ hasEditAction, onCopy, onEdit, copied }">
          <div class="demo-toolbar">
            <button
              type="button"
              class="story-icon-button"
              aria-label="Copy user message"
              title="Copy user message"
              @click="onCopy"
            >
              {{ copied ? "✓" : "⧉" }}
            </button>
            <button
              v-if="hasEditAction"
              type="button"
              class="story-icon-button"
              aria-label="Edit user message"
              title="Edit user message"
              @click="onEdit"
            >
              ✎
            </button>
          </div>
        </template>
      </CopilotChatUserMessage>
    `,
  }),
};

export const CustomComponents: Story = {
  decorators: [withStyles(CUSTOM_MESSAGE_CSS)],
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatUserMessage v-bind="args" class="demo-gradient">
        <template #message-renderer="{ content }">
          <div class="demo-mono">💬 {{ content }}</div>
        </template>
      </CopilotChatUserMessage>
    `,
  }),
};

export const UsingChildrenRenderProp: Story = {
  decorators: [withStyles(CUSTOM_MESSAGE_CSS)],
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessageLog("Edit clicked!"),
      };
    },
    template: `
      <CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage">
        <template #layout="{ content, onCopy, onEdit, hasEditAction, copied }">
          <div class="demo-note">
            <div class="demo-note__row">
              <div class="demo-note__content">{{ content }}</div>
              <div class="demo-note__actions">
                <button
                  type="button"
                  class="story-icon-button"
                  aria-label="Copy user message"
                  title="Copy user message"
                  @click="onCopy"
                >
                  {{ copied ? "✓" : "⧉" }}
                </button>
                <button
                  v-if="hasEditAction"
                  type="button"
                  class="story-icon-button"
                  aria-label="Edit user message"
                  title="Edit user message"
                  @click="onEdit"
                >
                  ✎
                </button>
              </div>
            </div>
            <div class="demo-note__caption">Custom layout using the layout slot</div>
          </div>
        </template>
      </CopilotChatUserMessage>
    `,
  }),
  args: {
    message: longMessage,
  },
};

export const WithBranchNavigation: Story = {
  args: {
    message: {
      id: "branch-message",
      content:
        "This message has multiple branches. You can navigate between them using the branch controls.",
      role: "user",
    },
    branchIndex: 2,
    numberOfBranches: 3,
  },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessageLog("Edit clicked!"),
        handleSwitchToBranch: handleSwitchToBranch(
          (branchIndex) => `Switching to branch ${branchIndex + 1}`,
        ),
      };
    },
    template: `
      <CopilotChatUserMessage
        v-bind="args"
        @edit-message="handleEditMessage"
        @switch-to-branch="handleSwitchToBranch"
      />
    `,
  }),
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
  },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return {
        args,
        handleEditMessage: handleEditMessageLog("Edit clicked!"),
        handleSwitchToBranch: handleSwitchToBranch(
          (branchIndex) => `Would switch to branch ${branchIndex + 1} of 10`,
        ),
      };
    },
    template: `
      <CopilotChatUserMessage
        v-bind="args"
        @edit-message="handleEditMessage"
        @switch-to-branch="handleSwitchToBranch"
      />
    `,
  }),
};
