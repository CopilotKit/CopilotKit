import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatInput,
  CopilotChatConfigurationProvider,
  type ToolsMenuItem,
} from "@copilotkitnext/react";

const meta = {
  title: "UI/CopilotChatInput",
  component: CopilotChatInput,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
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
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
The CopilotChatInput component provides a streamlined chat entry experience with a persistent add menu trigger that sits beside the text area. When the message grows beyond a single row, the textarea automatically moves above the controls to preserve layout.

## Key Features
- 📝 Auto-resizing textarea with configurable \`maxRows\`
- ➕ Dedicated add menu button that opens attachments or custom actions
- 🎤 Voice transcription mode with audio recorder
- 🎨 Fully themable through class overrides or slot replacements
- ♿ Keyboard accessible and screen-reader friendly

## Basic Usage

\`\`\`tsx
import { CopilotChatInput, CopilotChatConfigurationProvider } from '@copilotkitnext/react';

function ChatComponent() {
  return (
    <CopilotChatConfigurationProvider threadId="demo-thread">
      <CopilotChatInput
        onSubmitMessage={(value) => console.log('Message:', value)}
        onAddFile={() => console.log('Add file')}
      />
    </CopilotChatConfigurationProvider>
  );
}
\`\`\`

## Customization

The component supports deep customization via:
- **Slots** for the textarea, send button, add menu button, and audio recorder
- **Render props** to compose your own layout while reusing internal primitives
- **Props** such as \`toolsMenu\` for declarative menu configuration
- **Styling overrides** through Tailwind-compatible class names
        `,
      },
    },
  },
  argTypes: {
    mode: {
      control: { type: "radio" },
      options: ["input", "transcribe"],
      description: "Select between text entry and transcription modes",
      table: {
        type: { summary: "'input' | 'transcribe'" },
        defaultValue: { summary: "input" },
        category: "Behavior",
      },
    },
    toolsMenu: {
      description: "Menu configuration rendered inside the add button dropdown",
      table: {
        type: { summary: "(ToolsMenuItem | '-')[]" },
        category: "Features",
      },
    },
    addMenuButton: {
      description: "Slot override or class override for the add menu trigger",
      table: {
        type: { summary: "SlotValue<typeof CopilotChatInput.AddMenuButton>" },
        category: "Customization",
      },
    },
    sendButton: {
      description: "Slot override for the send button",
      table: {
        type: { summary: "SlotValue<typeof CopilotChatInput.SendButton>" },
        category: "Customization",
      },
    },
    textArea: {
      description: "Props or overrides for the textarea slot",
      table: {
        type: { summary: "SlotValue<typeof CopilotChatInput.TextArea>" },
        category: "Configuration",
      },
    },
    value: {
      control: { type: "text" },
      description: "Controlled input value",
      table: {
        type: { summary: "string" },
        category: "Data",
      },
    },
    onStartTranscribe: {
      action: "startTranscribe",
      description: "Invoked when transcription mode starts",
      table: {
        type: { summary: "() => void" },
        category: "Events",
      },
    },
    onCancelTranscribe: {
      action: "cancelTranscribe",
      description: "Invoked when transcription mode is cancelled",
      table: {
        type: { summary: "() => void" },
        category: "Events",
      },
    },
    onFinishTranscribe: {
      action: "finishTranscribe",
      description: "Invoked when transcription mode completes",
      table: {
        type: { summary: "() => void" },
        category: "Events",
      },
    },
    onAddFile: {
      action: "addFile",
      description: "Called when the default add menu item is selected",
      table: {
        type: { summary: "() => void" },
        category: "Events",
      },
    },
    onSubmitMessage: {
      action: "submit",
      description: "Called when the send button or Enter submits a message",
      table: {
        type: { summary: "(value: string) => void" },
        category: "Events",
      },
    },
  },
  args: {
    onStartTranscribe: () => console.log("Transcribe started"),
    onCancelTranscribe: () => console.log("Transcribe cancelled"),
    onFinishTranscribe: () => console.log("Transcribe completed"),
    onAddFile: () => console.log("Add file clicked"),
    onSubmitMessage: (value: string) => console.log(`Message sent: ${value}`),
  },
} satisfies Meta<typeof CopilotChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: "Default configuration with the add menu enabled and empty input.",
      },
      source: {
        code: `<CopilotChatInput />`,
      },
    },
  },
};

export const WithMenuItems: Story = {
  args: {
    toolsMenu: [
      {
        label: "Insert template",
        action: () => alert("Template inserted"),
      },
      "-",
      {
        label: "Advanced",
        items: [
          {
            label: "Summarize selection",
            action: () => alert("Summarize action"),
          },
          {
            label: "Tag teammate",
            action: () => alert("Tagging teammate"),
          },
        ],
      },
    ] as (ToolsMenuItem | "-")[],
  },
  parameters: {
    docs: {
      description: {
        story: "Demonstrates configuring nested items inside the add menu dropdown.",
      },
      source: {
        code: `<CopilotChatInput
  toolsMenu={[
    {
      label: "Insert template",
      action: () => alert("Template inserted")
    },
    "-",
    {
      label: "Advanced",
      items: [
        {
          label: "Summarize selection",
          action: () => alert("Summarize action")
        },
        {
          label: "Tag teammate",
          action: () => alert("Tagging teammate")
        }
      ]
    }
  ]}
/>`,
      },
    },
  },
};

export const TranscribeMode: Story = {
  args: {
    mode: "transcribe",
  },
  parameters: {
    docs: {
      description: {
        story: "Shows the audio recorder interface with cancel/finish controls in transcription mode.",
      },
      source: {
        code: `<CopilotChatInput mode="transcribe" />`,
      },
    },
  },
};

export const CustomButtons: Story = {
  args: {
    sendButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button
        {...props}
        className="mr-2 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40"
        aria-label="Send message"
      >
        ✈️
      </button>
    ),
    addMenuButton: {
      className: "border border-indigo-200 bg-white text-indigo-500 hover:bg-indigo-50",
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Overrides the send button with a custom component and tweaks the add menu button styling via slot props.",
      },
      source: {
        code: `<CopilotChatInput
  sendButton={(props) => (
    <button
      {...props}
      className="mr-2 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40"
      aria-label="Send message"
    >
      ✈️
    </button>
  )}
  addMenuButton={{
    className: "border border-indigo-200 bg-white text-indigo-500 hover:bg-indigo-50"
  }}
/>`,
      },
    },
  },
};

export const PrefilledText: Story = {
  args: {
    value: "Hello, this is a prefilled message!",
  },
  parameters: {
    docs: {
      description: {
        story: "Illustrates controlled usage by supplying a preset value to the textarea.",
      },
      source: {
        code: `<CopilotChatInput value="Hello, this is a prefilled message!" />`,
      },
    },
  },
};

export const ExpandedTextarea: Story = {
  args: {
    value:
      "This is a longer message that will cause the textarea to expand to multiple rows.\n\nThe textarea remains beside the add button until a wrap occurs, then moves above the controls.",
    textArea: {
      maxRows: 10,
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Demonstrates automatic multiline layout when the message spans multiple rows.",
      },
      source: {
        code: `<CopilotChatInput
  value="This is a longer message that will cause the textarea to expand to multiple rows.

The textarea remains beside the add button until a wrap occurs, then moves above the controls."
  textArea={{
    maxRows: 10
  }}
/>`,
      },
    },
  },
};

export const CustomStyling: Story = {
  decorators: [
    (Story) => (
      <>
        <style>{`
          .custom-chat-input {
            border: 2px solid #4f46e5 !important;
            border-radius: 14px !important;
            background: linear-gradient(to right, #eef2ff, #ffffff) !important;
            box-shadow: 0 4px 10px rgb(79 70 229 / 0.15) !important;
          }
          .custom-chat-input textarea {
            font-family: 'JetBrains Mono', monospace !important;
            font-size: 14px !important;
          }
        `}</style>
        <Story />
      </>
    ),
  ],
  args: {
    className: "custom-chat-input",
    addMenuButton: {
      className: "border border-indigo-300 bg-white text-indigo-600",
    },
    sendButton: {
      className: "bg-indigo-500 text-white hover:bg-indigo-600",
    },
  },
  parameters: {
    docs: {
      description: {
        story: "Applies custom classes to the container and key slots to achieve a distinct visual style.",
      },
      source: {
        code: `<CopilotChatInput
  className="custom-chat-input"
  addMenuButton={{
    className: "border border-indigo-300 bg-white text-indigo-600"
  }}
  sendButton={{
    className: "bg-indigo-500 text-white hover:bg-indigo-600"
  }}
/>`,
      },
    },
  },
};

export const CustomLayout: Story = {
  render: (args) => (
    <CopilotChatInput {...args}>
      {(
        {
          textArea,
          sendButton,
          addMenuButton,
          isMultiline,
        },
      ) => (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">
              {isMultiline ? "Multiline message" : "Single line message"}
            </span>
            {addMenuButton}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">{textArea}</div>
            {sendButton}
          </div>
        </div>
      )}
    </CopilotChatInput>
  ),
  parameters: {
    docs: {
      description: {
        story: "Uses the render prop API to compose a custom layout while still leveraging the provided slots.",
      },
      source: {
        code: `<CopilotChatInput>
  {({ textArea, sendButton, addMenuButton, isMultiline }) => (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">
          {isMultiline ? "Multiline message" : "Single line message"}
        </span>
        {addMenuButton}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">{textArea}</div>
        {sendButton}
      </div>
    </div>
  )}
</CopilotChatInput>`,
      },
    },
  },
};

export const ControlledInputExample: Story = {
  render: (args) => {
    const [value, setValue] = useState("Draft message ready to send.");

    return (
      <CopilotChatInput
        {...args}
        value={value}
        onChange={setValue}
        onSubmitMessage={(submitted) => {
          alert(`Submitted: ${submitted}`);
          setValue("");
        }}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Showcases a controlled input pattern with external state management.",
      },
      source: {
        code: `const [value, setValue] = useState("Draft message ready to send.");

<CopilotChatInput
  value={value}
  onChange={setValue}
  onSubmitMessage={(submitted) => {
    alert(\`Submitted: \${submitted}\`);
    setValue("");
  }}
/>`,
      },
    },
  },
};
