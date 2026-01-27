import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

import {
  CopilotModalHeader,
  CopilotSidebarView,
  type CopilotSidebarViewProps,
} from "@copilotkitnext/react";
import { CopilotStoryLayout } from "./CopilotStoryLayout";

const meta = {
  title: "UI/CopilotSidebarView",
  component: CopilotSidebarView,
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => (
    <CopilotStoryLayout>
      <CopilotSidebarView {...(args as CopilotSidebarViewProps)} />
    </CopilotStoryLayout>
  ),
} satisfies Meta<typeof CopilotSidebarView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    autoScroll: true,
  },
};

export const CustomHeader: Story = {
  args: {
    header: {
      title: "Workspace Copilot",
      titleContent: (props) => (
        <CopilotModalHeader.Title
          {...props}
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          <span>{props.children}</span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Always-on teammate
          </span>
        </CopilotModalHeader.Title>
      ),
      closeButton: (props) => (
        <CopilotModalHeader.CloseButton
          {...props}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        />
      ),
    },
  },
};
