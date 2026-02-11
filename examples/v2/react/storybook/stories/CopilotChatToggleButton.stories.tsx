import type { Meta, StoryObj } from "@storybook/react";
import { MessageCirclePlus, Minus } from "lucide-react";
import React from "react";

import {
  CopilotChatConfigurationProvider,
  CopilotChatToggleButton,
  type CopilotChatToggleButtonProps,
  useCopilotChatConfiguration,
} from "@copilotkitnext/react";

const StatePreview: React.FC<CopilotChatToggleButtonProps> = (args) => {
  const configuration = useCopilotChatConfiguration();

  return (
    <div className="flex flex-col items-center gap-3">
      <CopilotChatToggleButton {...args} />
      <span className="text-sm text-muted-foreground">
        {configuration?.isModalOpen ? "Chat is open" : "Chat is closed"}
      </span>
    </div>
  );
};

const meta = {
  title: "UI/CopilotChatToggleButton",
  component: CopilotChatToggleButton,
  parameters: {
    layout: "centered",
  },
  render: (args) => (
    <CopilotChatConfigurationProvider threadId="storybook-toggle-button">
      <StatePreview {...args} />
    </CopilotChatConfigurationProvider>
  ),
} satisfies Meta<typeof CopilotChatToggleButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCustomIcons: Story = {
  args: {
    openIcon: (props) => (
      <MessageCirclePlus
        {...props}
        className={[props.className, "text-emerald-400"].filter(Boolean).join(" ")}
        strokeWidth={1.5}
      />
    ),
    closeIcon: (props) => (
      <Minus
        {...props}
        className={[props.className, "text-rose-400"].filter(Boolean).join(" ")}
        strokeWidth={2}
      />
    ),
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
