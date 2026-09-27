import type { Decorator, Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChat, CopilotThreadsDrawer } from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { reactHooksConversation } from "./support/fixtures";
import {
  pinnedError,
  pinnedThreads,
  withLicense,
  withPinnedDrawer,
} from "./support/threads-drawer";

/**
 * `CopilotThreadsDrawer` lists the agent's Intelligence threads. It is a thin
 * Vue controller around the `<copilotkit-threads-drawer>` element: thread data
 * comes from `useThreads`, which needs a CopilotKit Intelligence runtime, and
 * the locked/unlocked view comes from the license the runtime reports.
 *
 * Offline, these stories pin the license through `LicenseContextKey` and, where
 * a thread list or error is needed, pin those fields on the underlying element
 * (`withPinnedDrawer`). That reaches every visual state; row actions
 * (archive, delete, load more) dispatch but have no backend to act on.
 */

/** The drawer is an in-flow column on desktop; give it a page to sit in. */
const withChatArea: Decorator = (story) => ({
  components: { story },
  template: `
    <div style="display: flex; height: 100vh; overflow: hidden">
      <story />
      <div class="story-caption" style="display: flex; flex: 1; align-items: center; justify-content: center">
        Chat area
      </div>
    </div>
  `,
});

const meta = {
  title: "UI/CopilotThreadsDrawer",
  component: CopilotThreadsDrawer,
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => ({
    components: { CopilotThreadsDrawer },
    setup() {
      return { args };
    },
    template: `<CopilotThreadsDrawer v-bind="args" />`,
  }),
} satisfies Meta<typeof CopilotThreadsDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

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

/** While the runtime's license status is still unknown. */
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
    (story) => ({
      components: { story, CopilotChat },
      template: `
        <div style="display: flex; height: 100vh; overflow: hidden">
          <story />
          <div style="min-width: 0; flex: 1">
            <CopilotChat />
          </div>
        </div>
      `,
    }),
    withPinnedDrawer(pinnedThreads),
    withLicense("valid"),
  ],
  parameters: {
    copilotkit: {
      agent: { initialMessages: reactHooksConversation },
    } satisfies CopilotKitStoryParameters,
  },
};
