import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { userEvent, within } from "storybook/test";
import { CopilotSidebar } from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { reactHooksConversation } from "./support/fixtures";
import HostPage from "./support/HostPage.vue";
import {
  pinnedThreads,
  withLicense,
  withPinnedDrawer,
} from "./support/threads-drawer";

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
  render: (args) => ({
    components: { CopilotSidebar, HostPage },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotSidebar v-bind="args" />
      </HostPage>
    `,
  }),
} satisfies Meta<typeof CopilotSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open on a fresh thread: the sidebar's welcome screen. */
export const Default: Story = {};

/** An existing thread restored from the agent. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};

export const CustomWidth: Story = {
  args: {
    width: 360,
  },
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Closed: only the toggle button shows. Click it to open the sidebar. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
};

/**
 * `threads-drawer` adds a thread-list launcher to the header (top-left). It
 * opens the threads drawer over the sidebar; picking a thread, Escape or the
 * scrim closes it.
 */
export const WithThreadsDrawer: Story = {
  args: {
    threadsDrawer: true,
  },
  decorators: [withPinnedDrawer(pinnedThreads), withLicense("valid")],
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/** The drawer open over the chat, with the active thread highlighted. */
export const WithThreadsDrawerOpen: Story = {
  ...WithThreadsDrawer,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByTestId("drawer-launcher"),
    );
  },
};
