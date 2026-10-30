import type { Meta, StoryObj } from "@storybook/react";
import React from "react";

import {
  CopilotModalHeader,
  CopilotSidebarView,
} from "@copilotkit/react-core/v2";
import type { CopilotSidebarViewProps } from "@copilotkit/react-core/v2";
import { fn } from "storybook/test";
import { starterSuggestions } from "./support/fixtures";
import { HostPage } from "./support/HostPage";

const meta = {
  title: "UI/CopilotSidebarView",
  component: CopilotSidebarView,
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => (
    <HostPage>
      <CopilotSidebarView {...(args as CopilotSidebarViewProps)} />
    </HostPage>
  ),
} satisfies Meta<typeof CopilotSidebarView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    autoScroll: true,
  },
};

export const RightPosition: Story = {
  args: {
    autoScroll: true,
    position: "right",
    width: 480,
  },
};

export const LeftPosition: Story = {
  args: {
    autoScroll: true,
    position: "left",
    width: 480,
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

/**
 * No messages: the sidebar's welcome screen. The greeting, the suggestion
 * cards (one column at sidebar width) and the input sit centered together.
 */
export const WelcomeScreen: Story = {
  args: {
    messages: [],
    suggestions: starterSuggestions,
    onSelectSuggestion: fn(),
  },
};
