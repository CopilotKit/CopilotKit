import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotPopup } from "@copilotkit/react-core";
import { reactHooksConversation } from "./support/fixtures";
import { HostPage } from "./support/HostPage";
import { withStandaloneCopilotKit } from "./support/providers";

/**
 * `CopilotPopup` floats a fully wired chat above the host app, anchored to its
 * toggle button. Stories render it over `HostPage` so it can be judged in
 * context.
 */
const meta = {
  title: "UI/CopilotPopup",
  component: CopilotPopup,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    defaultOpen: true,
    clickOutsideToClose: false,
  },
  render: (args) => (
    <HostPage>
      <CopilotPopup {...args} />
    </HostPage>
  ),
} satisfies Meta<typeof CopilotPopup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open on a fresh thread: the popup's welcome screen. */
export const Default: Story = {
  decorators: [withStandaloneCopilotKit()],
  parameters: { copilotkit: false },
};

/** An existing thread restored when the chat connects. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: { agent: { initialMessages: reactHooksConversation } },
  },
};

export const CustomSize: Story = {
  args: {
    width: 360,
    height: 480,
  },
  parameters: {
    copilotkit: { agent: { initialMessages: reactHooksConversation } },
  },
};

/** Closed: only the toggle button shows. Click it to open the popup. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
  decorators: [withStandaloneCopilotKit()],
  parameters: { copilotkit: false },
};
