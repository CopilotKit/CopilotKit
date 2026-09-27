import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChat, CopilotThreadsDrawer } from "@copilotkit/angular";
import {
  pinDrawer,
  pinnedEmpty,
  pinnedError,
  pinnedLoading,
  pinnedLocked,
  pinnedThreads,
} from "./support/threads-drawer";
import type { PinnedDrawerFields } from "./support/threads-drawer";

/**
 * `<copilot-threads-drawer>` lists threads from CopilotKit Intelligence, which
 * needs a licensed runtime. Storybook has none, so each story pins the drawer
 * element's data (see support/threads-drawer.ts) to show one visual state.
 * The popup and sidebar host it too: see their `WithThreadsDrawer` stories.
 */
const meta: Meta<CopilotThreadsDrawer> = {
  title: "UI/CopilotThreadsDrawer",
  component: CopilotThreadsDrawer,
  decorators: [
    moduleMetadata({ imports: [CopilotThreadsDrawer, CopilotChat] }),
  ],
  parameters: { layout: "fullscreen" },
  render: () => ({
    template: `
      <div class="story-drawer-layout">
        <copilot-threads-drawer label="Conversations" />
        <div class="story-drawer-placeholder">Chat area</div>
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotThreadsDrawer>;

const pinned =
  (fields: PinnedDrawerFields): Story["play"] =>
  async ({ canvasElement }) => {
    await pinDrawer(canvasElement, fields);
  };

/** A thread list with the first thread active. Hover a row for its actions. */
export const WithThreads: Story = { play: pinned(pinnedThreads) };

export const Empty: Story = { play: pinned(pinnedEmpty) };

export const Loading: Story = { play: pinned(pinnedLoading) };

export const LoadError: Story = { play: pinned(pinnedError) };

/** Without a license that includes threads, the drawer shows an upgrade CTA. */
export const Locked: Story = { play: pinned(pinnedLocked) };

/** The drawer beside a live chat. */
export const WithChat: Story = {
  render: () => ({
    template: `
      <div class="story-drawer-layout">
        <copilot-threads-drawer label="Conversations" />
        <copilot-chat />
      </div>
    `,
  }),
  play: pinned(pinnedThreads),
};
