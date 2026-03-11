import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatUserMessage,
  CopilotChatConfigurationProvider,
  type CopilotChatUserMessageProps,
} from "@copilotkitnext/react";

// Simple default message
const simpleMessage = {
  id: "simple-user-message",
  content: "Hello! Can you help me build a React component?",
  timestamp: new Date(),
  role: "user" as const,
};

// Longer user message
const longMessage = {
  id: "long-user-message",
  content: `I need help with creating a complex React component that handles user authentication. Here are my requirements:

1. The component should have login and signup forms
2. It needs to integrate with Firebase Auth
3. Should handle form validation
4. Must be responsive and work on mobile
5. Include forgot password functionality
6. Support social login (Google, GitHub)

Can you help me implement this step by step? I'm particularly struggling with the form validation and state management parts.`,
  timestamp: new Date(),
  role: "user" as const,
};

// Code-related user message
const codeMessage = {
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
  timestamp: new Date(),
  role: "user" as const,
};

// Short question
const shortMessage = {
  id: "short-user-message",
  content: "What's the difference between useState and useReducer?",
  timestamp: new Date(),
  role: "user" as const,
};

const meta = {
  title: "UI/CopilotChatUserMessage",
  component: CopilotChatUserMessage,
  decorators: [
    (Story) => (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          minHeight: "100vh",
          padding: "16px",
        }}
      >
        <div style={{ width: "100%", maxWidth: "640px" }}>
          <CopilotChatConfigurationProvider threadId="storybook-thread">
            <Story />
          </CopilotChatConfigurationProvider>
        </div>
      </div>
    ),
  ],
  args: {
    message: simpleMessage,
    onEditMessage: () => console.log("Edit clicked!"),
  },
} satisfies Meta<typeof CopilotChatUserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    docs: {
      source: {
        code: `<CopilotChatUserMessage
  message={{
    id: "simple-user-message",
    content: "Hello! Can you help me build a React component?",
    timestamp: new Date(),
    role: "user"
  }}
/>`,
      },
    },
  },
};

export const LongMessage: Story = {
  args: {
    message: longMessage,
  },
};

export const WithEditButton: Story = {
  args: {
    message: simpleMessage,
    onEditMessage: () => alert("Edit message clicked!"),
  },
  parameters: {
    docs: {
      source: {
        code: `<CopilotChatUserMessage
  message={{
    id: "simple-user-message",
    content: "Hello! Can you help me build a React component?",
    timestamp: new Date(),
    role: "user"
  }}
  onEditMessage={() => alert("Edit message clicked!")}
/>`,
      },
    },
  },
};

export const WithoutEditButton: Story = {
  args: {
    message: simpleMessage,
    onEditMessage: undefined, // No edit callback means no edit button
  },
};

export const CodeRelatedMessage: Story = {
  args: {
    message: codeMessage,
    onEditMessage: () => alert("Edit code message clicked!"),
  },
};

export const ShortQuestion: Story = {
  args: {
    message: shortMessage,
    onEditMessage: () => console.log("Edit short message clicked!"),
  },
};

export const WithAdditionalToolbarItems: Story = {
  args: {
    message: simpleMessage,
    onEditMessage: () => console.log("Edit clicked!"),
    additionalToolbarItems: (
      <>
        <button
          className="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
          onClick={() => alert("Custom button 1 clicked!")}
          title="Custom Action 1"
        >
          📎
        </button>
        <button
          className="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
          onClick={() => alert("Custom button 2 clicked!")}
          title="Custom Action 2"
        >
          🔄
        </button>
      </>
    ),
  },
  parameters: {
    docs: {
      source: {
        code: `<CopilotChatUserMessage
  message={{
    id: "simple-user-message",
    content: "Hello! Can you help me build a React component?",
    timestamp: new Date(),
    role: "user"
  }}
  onEditMessage={() => console.log("Edit clicked!")}
  additionalToolbarItems={
    <>
      <button
        className="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
        onClick={() => alert("Custom button 1 clicked!")}
        title="Custom Action 1"
      >
        📎
      </button>
      <button
        className="h-8 w-8 p-0 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
        onClick={() => alert("Custom button 2 clicked!")}
        title="Custom Action 2"
      >
        🔄
      </button>
    </>
  }
/>`,
      },
    },
  },
};

export const CustomAppearance: Story = {
  args: {
    message: simpleMessage,
    onEditMessage: () => console.log("Edit clicked!"),
    className: "bg-blue-50 border border-blue-200 rounded-lg p-4",
    messageRenderer: ({ content }) => (
      <div className="prose dark:prose-invert bg-muted relative max-w-[80%] rounded-[18px] px-4 py-1.5 data-[multiline]:py-3 inline-block whitespace-pre-wrap text-blue-900 font-medium">
        {content}
      </div>
    ),
    toolbar: ({
      children,
      className,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => (
      <div
        className="w-full bg-transparent flex items-center justify-end -mr-[5px] mt-[8px] invisible group-hover:visible"
        {...props}
      >
        {children}
      </div>
    ),
    copyButton: ({
      children,
      className,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button
        className="h-8 w-8 p-0 rounded-md text-blue-600 hover:bg-blue-100 flex items-center justify-center"
        {...props}
      >
        {children}
      </button>
    ),
    editButton: ({
      children,
      className,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button
        className="h-8 w-8 p-0 rounded-md text-blue-600 hover:bg-blue-100 flex items-center justify-center"
        {...props}
      >
        {children}
      </button>
    ),
  },
};

export const CustomComponents: Story = {
  args: {
    message: simpleMessage,
    onEditMessage: () => console.log("Edit clicked!"),
    className:
      "bg-gradient-to-r from-purple-100 to-pink-100 rounded-xl p-4 shadow-sm",
    messageRenderer: ({ content }: { content: string; className?: string }) => (
      <div className="font-mono text-purple-800 bg-white/50 rounded-lg px-3 py-2 inline-block">
        💬 {content}
      </div>
    ),
  },
};

export const UsingChildrenRenderProp: Story = {
  args: {
    message: longMessage,
    onEditMessage: () => console.log("Edit clicked!"),
    children: ({
      messageRenderer,
      toolbar,
      copyButton,
      editButton,
    }: {
      messageRenderer: React.ReactElement;
      toolbar: React.ReactElement;
      copyButton: React.ReactElement;
      editButton: React.ReactElement;
      branchNavigation: React.ReactElement;
      message: any;
      branchIndex?: number;
      numberOfBranches?: number;
      additionalToolbarItems?: React.ReactNode;
    }) => (
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 mr-4">{messageRenderer}</div>
          <div className="flex items-center gap-1">
            {copyButton}
            {editButton}
          </div>
        </div>
        <div className="mt-2 text-xs text-yellow-700">
          Custom layout using children render prop
        </div>
      </div>
    ),
  },
};

export const WithBranchNavigation: Story = {
  args: {
    message: {
      id: "branch-message",
      content:
        "This message has multiple branches. You can navigate between them using the branch controls.",
      role: "user" as const,
    },
    onEditMessage: () => console.log("Edit clicked!"),
    branchIndex: 2,
    numberOfBranches: 3,
    onSwitchToBranch: ({ branchIndex }) =>
      console.log(`Switching to branch ${branchIndex + 1}`),
  },
};

export const WithManyBranches: Story = {
  args: {
    message: {
      id: "many-branches-message",
      content:
        "This is branch 5 of 10. Use the navigation arrows to explore different variations of this message.",
      role: "user" as const,
    },
    onEditMessage: () => console.log("Edit clicked!"),
    branchIndex: 4,
    numberOfBranches: 10,
    onSwitchToBranch: ({ branchIndex }) =>
      alert(`Would switch to branch ${branchIndex + 1} of 10`),
  },
};
