import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  CopilotModalHeader,
  CopilotPopupView,
} from "@copilotkit/react-core/v2";
import type { CopilotPopupViewProps } from "@copilotkit/react-core/v2";
import { reactHooksConversation, starterSuggestions } from "./support/fixtures";
import { HostPage } from "./support/HostPage";

/**
 * `CopilotPopupView` is the presentational popup shell: it takes messages and
 * callbacks as props instead of binding to an agent (`CopilotPopup` wires it
 * up).
 */
const meta = {
  title: "UI/CopilotPopupView",
  component: CopilotPopupView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    messages: reactHooksConversation,
    clickOutsideToClose: false,
    onSubmitMessage: fn(),
  },
  render: (args) => (
    <HostPage>
      <CopilotPopupView {...(args as CopilotPopupViewProps)} />
    </HostPage>
  ),
} satisfies Meta<typeof CopilotPopupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * No messages: the popup's welcome screen. The greeting, the suggestion
 * cards (one column at popup width) and the input sit centered together.
 */
export const WelcomeScreen: Story = {
  args: {
    messages: [],
    suggestions: starterSuggestions,
    onSelectSuggestion: fn(),
  },
};

export const CustomSize: Story = {
  args: {
    width: 360,
    height: 480,
  },
};

export const CustomHeader: Story = {
  args: {
    header: {
      title: "Acme Assistant",
      titleContent: (props) => (
        <CopilotModalHeader.Title {...props}>
          <span className="block">{props.children}</span>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Replies in a few seconds
          </span>
        </CopilotModalHeader.Title>
      ),
    },
  },
};

/** Closed: only the toggle button shows. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
};
