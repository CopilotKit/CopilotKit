import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Minus } from "lucide-react";
import { CopilotModalHeader } from "@copilotkit/react-core/v2";

/**
 * The header used by `CopilotPopupView` and `CopilotSidebarView`. Its title
 * defaults to the `modalHeaderTitle` label; the close button closes the
 * surrounding modal.
 */
const meta = {
  title: "UI/CopilotModalHeader",
  component: CopilotModalHeader,
  decorators: [
    (Story) => (
      <div className="flex min-h-[320px] items-start justify-center p-10">
        <div
          data-copilotkit
          className="w-full max-w-md overflow-hidden rounded-2xl border border-border shadow-sm"
        >
          <Story />
          <div className="h-40" />
        </div>
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotModalHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomTitle: Story = {
  args: {
    title: "Acme Assistant",
  },
};

export const CustomCloseButton: Story = {
  args: {
    title: "Acme Assistant",
    closeButton: ({ onClick }) => (
      <button
        type="button"
        onClick={onClick}
        aria-label="Minimize"
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
    ),
  },
};

/** The `children` render prop re-arranges the bound slots. */
export const CustomLayout: Story = {
  args: {
    title: "Acme Assistant",
    children: ({ titleContent, closeButton }) => (
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="size-7 shrink-0 rounded-full bg-primary" />
        <div className="min-w-0 flex-1 text-left">{titleContent}</div>
        {closeButton}
      </header>
    ),
  },
};
