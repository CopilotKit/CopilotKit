import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

import {
  CopilotModalHeader,
  CopilotPopup,
  type CopilotPopupProps,
} from "@copilotkitnext/react";
import { CopilotStoryLayout } from "./CopilotStoryLayout";

const meta = {
  title: "UI/CopilotPopup",
  component: CopilotPopup,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    defaultOpen: {
      control: { type: "boolean" },
    },
    clickOutsideToClose: {
      control: { type: "boolean" },
    },
    width: {
      control: { type: "number" },
    },
    height: {
      control: { type: "number" },
    },
  },
  render: (args) => {
    const { defaultOpen, ...rest } = args as CopilotPopupProps;

    return (
      <CopilotStoryLayout isModalDefaultOpen={defaultOpen ?? false}>
        <CopilotPopup {...rest} defaultOpen={defaultOpen} />
      </CopilotStoryLayout>
    );
  },
} satisfies Meta<typeof CopilotPopup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    defaultOpen: true,
    width: 480,
    height: 720,
    clickOutsideToClose: false,
  },
};

export const CustomHeader: Story = {
  args: {
    defaultOpen: true,
    clickOutsideToClose: true,
    header: {
      title: "Workspace Copilot",
      titleContent: (props) => (
        <CopilotModalHeader.Title
          {...props}
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          <span>{props.children}</span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Popup assistant
          </span>
        </CopilotModalHeader.Title>
      ),
      closeButton: (props) => (
        <CopilotModalHeader.CloseButton
          {...props}
          className="text-primary hover:bg-primary/10 hover:text-primary"
        />
      ),
    },
  },
};

export const ClickOutsideToClose: Story = {
  args: {
    defaultOpen: true,
    clickOutsideToClose: true,
  },
};
