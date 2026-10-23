import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotChat, CopilotThreadsDrawer } from "@copilotkit/react-core/v2";
import { reactHooksConversation } from "./support/fixtures";
import {
  pinnedError,
  pinnedThreads,
  withLicense,
  withPinnedDrawer,
} from "./support/threads-drawer";

/**
 * `CopilotThreadsDrawer` lists the agent's Intelligence threads. It is a thin
 * React controller around the `<copilotkit-threads-drawer>` element: thread
 * data comes from `useThreads`, which needs a CopilotKit Intelligence runtime,
 * and the locked/unlocked view comes from the license the runtime reports.
 * These stories pin both offline (see `support/threads-drawer.tsx`).
 *
 * To host the drawer inside a chat popup or sidebar instead, see the
 * `WithThreadsDrawer` stories of `CopilotPopup` and `CopilotSidebar`.
 */

/** The drawer is an in-flow column on desktop; give it a page to sit in. */
const withChatArea = (Story: React.ComponentType) => (
  <div className="flex h-screen overflow-hidden">
    <Story />
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Chat area
    </div>
  </div>
);

const meta = {
  title: "UI/CopilotThreadsDrawer",
  component: CopilotThreadsDrawer,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotThreadsDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A thread list with the first thread active. Hover a row for its actions. */
export const WithThreads: Story = {
  decorators: [
    withChatArea,
    withPinnedDrawer(pinnedThreads),
    withLicense("valid"),
  ],
};

/** Licensed, with no threads yet. */
export const Empty: Story = {
  decorators: [withChatArea, withLicense("valid")],
};

/** While the runtime's license status is still unknown: skeleton rows. */
export const Loading: Story = {
  decorators: [withChatArea],
};

/** The initial thread fetch failed; the element offers a retry. */
export const LoadError: Story = {
  decorators: [
    withChatArea,
    withPinnedDrawer(pinnedError),
    withLicense("valid"),
  ],
};

/** No Intelligence license: the upgrade call to action. */
export const Locked: Story = {
  decorators: [withChatArea, withLicense("none")],
};

/** In context next to a chat, the way apps lay it out. */
export const WithChat: Story = {
  decorators: [
    (Story) => (
      <div className="flex h-screen overflow-hidden">
        <Story />
        <div className="min-w-0 flex-1">
          <CopilotChat />
        </div>
      </div>
    ),
    withPinnedDrawer(pinnedThreads),
    withLicense("valid"),
  ],
  parameters: {
    copilotkit: { agent: { initialMessages: reactHooksConversation } },
  },
};
