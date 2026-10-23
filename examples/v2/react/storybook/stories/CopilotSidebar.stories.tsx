import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { reactHooksConversation } from "./support/fixtures";
import { HostPage } from "./support/HostPage";
import { withStandaloneCopilotKit } from "./support/providers";

/**
 * `CopilotSidebar` docks a fully wired chat to the edge of the host app, with
 * a toggle button to open and close it. Stories render it over `HostPage` so
 * the panel can be judged in context.
 */
const meta = {
  title: "UI/CopilotSidebar",
  component: CopilotSidebar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    defaultOpen: true,
  },
  render: (args) => (
    <HostPage>
      <CopilotSidebar {...args} />
    </HostPage>
  ),
} satisfies Meta<typeof CopilotSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open on a fresh thread: the sidebar's welcome screen. */
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

export const LeftPosition: Story = {
  args: {
    position: "left",
  },
  parameters: {
    copilotkit: { agent: { initialMessages: reactHooksConversation } },
  },
};

/** Closed: only the toggle button shows. Click it to open the sidebar. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
  decorators: [withStandaloneCopilotKit()],
  parameters: { copilotkit: false },
};
