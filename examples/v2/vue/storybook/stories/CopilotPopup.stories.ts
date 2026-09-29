import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { userEvent, within } from "storybook/test";
import { CopilotPopup } from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { reactHooksConversation } from "./support/fixtures";
import HostPage from "./support/HostPage.vue";
import StoryCustomThreadsDrawer from "./support/StoryCustomThreadsDrawer.vue";
import {
  pinnedThreads,
  withLicense,
  withPinnedDrawer,
} from "./support/threads-drawer";

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
  render: (args) => ({
    components: { CopilotPopup, HostPage },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotPopup v-bind="args" />
      </HostPage>
    `,
  }),
} satisfies Meta<typeof CopilotPopup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open on a fresh thread: the popup's welcome screen. */
export const Default: Story = {};

/** An existing thread restored from the agent. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};

export const CustomSize: Story = {
  args: {
    width: 360,
    height: 480,
  },
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Closed: only the toggle button shows. Click it to open the popup. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
};

/**
 * `threads-drawer` adds a thread-list launcher to the header (top-left). It
 * opens the threads drawer over the popup; picking a thread, Escape or the
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

/**
 * A `threads-drawer` slot replaces the default drawer (and turns it on). The
 * slot hands the replacement its open state, and the header launcher opens it
 * like the default.
 */
export const WithCustomThreadsDrawer: Story = {
  render: (args) => ({
    components: { CopilotPopup, HostPage, StoryCustomThreadsDrawer },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotPopup v-bind="args">
          <template #threads-drawer="drawer">
            <StoryCustomThreadsDrawer v-bind="drawer" />
          </template>
        </CopilotPopup>
      </HostPage>
    `,
  }),
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByTestId("drawer-launcher"),
    );
  },
};
