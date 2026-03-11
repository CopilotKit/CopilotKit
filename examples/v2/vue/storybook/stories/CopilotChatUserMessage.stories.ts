import type { UserMessage } from "@ag-ui/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatConfigurationProvider,
  CopilotChatUserMessage,
} from "@copilotkitnext/vue";

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

TypeError: Cannot read property 'map' of undefined

The error happens in this component:

function UserList({ users }) {
  return (
    <div>
      {users.map(user => (
        <div key={user.id}>{user.name}</div>
      ))}
    </div>
  );
}

How can I fix this?`,
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
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (story) => ({
      components: { story, CopilotChatConfigurationProvider },
      template: `
        <div
          style="
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            padding: 16px;
          "
        >
          <div style="width: 100%; max-width: 640px">
            <CopilotChatConfigurationProvider thread-id="storybook-thread">
              <story />
            </CopilotChatConfigurationProvider>
          </div>
        </div>
      `,
    }),
  ],
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
      const handleEditMessage = () => window.alert("Edit message clicked!");
      return { args, handleEditMessage };
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
      const handleEditMessage = () => window.alert("Edit code message clicked!");
      return { args, handleEditMessage };
    },
    template: `<CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage" />`,
  }),
};

export const ShortQuestion: Story = {
  args: { message: shortMessage },
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      const handleEditMessage = () => console.log("Edit short message clicked!");
      return { args, handleEditMessage };
    },
    template: `<CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage" />`,
  }),
};

export const WithAdditionalToolbarItems: Story = {
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      const onCustomButton1 = () => {
        window.alert("Custom button 1 clicked!");
      };
      const onCustomButton2 = () => {
        window.alert("Custom button 2 clicked!");
      };
      return { args, onCustomButton1, onCustomButton2 };
    },
    template: `
      <CopilotChatUserMessage v-bind="args">
        <template #toolbar-items>
          <button
            type="button"
            class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
            title="Custom Action 1"
            @click="onCustomButton1"
          >
            📎
          </button>
          <button
            type="button"
            class="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
            title="Custom Action 2"
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
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatUserMessage v-bind="args">
        <template #message-renderer="{ content }">
          <div
            class="prose dark:prose-invert relative max-w-[80%] rounded-[18px] px-4 py-1.5 inline-block whitespace-pre-wrap text-blue-900 font-medium"
            style="background: #eff6ff"
          >
            {{ content }}
          </div>
        </template>
        <template #toolbar="{ message, showBranchNavigation, hasEditAction, onCopy, onEdit, copied }">
          <div
            style="
              width: 100%;
              background: transparent;
              display: flex;
              align-items: center;
              justify-content: flex-end;
              margin-right: -5px;
              margin-top: 8px;
              gap: 4px;
            "
          >
            <button
              type="button"
              aria-label="Copy user message"
              title="Copy user message"
              @click="onCopy"
              style="height:32px; width:32px; border-radius:6px; color:#2563eb"
            >
              {{ copied ? "✓" : "⧉" }}
            </button>
            <button
              v-if="hasEditAction"
              type="button"
              aria-label="Edit user message"
              title="Edit user message"
              @click="onEdit"
              style="height:32px; width:32px; border-radius:6px; color:#2563eb"
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
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatUserMessage
        v-bind="args"
        class="bg-gradient-to-r from-purple-100 to-pink-100 rounded-xl p-4 shadow-sm"
      >
        <template #message-renderer="{ content }">
          <div
            class="font-mono text-purple-800 rounded-lg px-3 py-2 inline-block"
            style="background: rgba(255, 255, 255, 0.5)"
          >
            💬 {{ content }}
          </div>
        </template>
      </CopilotChatUserMessage>
    `,
  }),
};

export const UsingChildrenRenderProp: Story = {
  render: (args: Story["args"]) => ({
    components: { CopilotChatUserMessage },
    setup() {
      const handleEditMessage = () => console.log("Edit clicked!");
      return { args, handleEditMessage };
    },
    template: `
      <CopilotChatUserMessage v-bind="args" @edit-message="handleEditMessage">
        <template #layout="{ content, onCopy, onEdit, hasEditAction, copied }">
          <div class="bg-yellow-50 p-4">
            <div class="flex items-start justify-between">
              <div class="flex-1 mr-4">
                <div
                  class="prose dark:prose-invert bg-muted relative max-w-[80%] rounded-[18px] px-4 py-1.5 inline-block whitespace-pre-wrap"
                >
                  {{ content }}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  @click="onCopy"
                  style="height:32px; width:32px; border-radius:6px"
                  aria-label="Copy user message"
                  title="Copy user message"
                >
                  {{ copied ? "✓" : "⧉" }}
                </button>
                <button
                  v-if="hasEditAction"
                  type="button"
                  @click="onEdit"
                  style="height:32px; width:32px; border-radius:6px"
                  aria-label="Edit user message"
                  title="Edit user message"
                >
                  ✎
                </button>
              </div>
            </div>
            <div class="mt-2 text-xs text-yellow-700">
              Custom layout using children render prop
            </div>
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
      const handleEditMessage = () => console.log("Edit clicked!");
      const handleSwitchToBranch = ({ branchIndex }: { branchIndex: number }) =>
        console.log(`Switching to branch ${branchIndex + 1}`);
      return { args, handleEditMessage, handleSwitchToBranch };
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
      const handleEditMessage = () => console.log("Edit clicked!");
      const handleSwitchToBranch = ({ branchIndex }: { branchIndex: number }) =>
        window.alert(`Would switch to branch ${branchIndex + 1} of 10`);
      return { args, handleEditMessage, handleSwitchToBranch };
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
