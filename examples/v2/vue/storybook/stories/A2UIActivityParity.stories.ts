import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { ActivityMessage, Message } from "@ag-ui/core";
import {
  A2UISurfaceActivityRenderer,
  A2UISurfaceActivityType,
  CopilotChatMessageView,
  vueBasicCatalog,
} from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import { withMessageColumn } from "./support/layouts";

const sampleContent = {
  operations: [
    {
      version: "v0.9",
      createSurface: {
        surfaceId: "story-surface",
        catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "story-surface",
        components: [
          { id: "root", component: "Column", children: ["title", "body"] },
          {
            id: "title",
            component: "Text",
            text: "Hello from A2UI",
            variant: "h3",
          },
          {
            id: "body",
            component: "Text",
            text: "This surface was declared by the agent and rendered with the basic catalog.",
            variant: "body",
          },
        ],
      },
    },
  ],
};

const activityMessage: ActivityMessage = {
  id: "story-activity",
  role: "activity",
  activityType: A2UISurfaceActivityType,
  content: sampleContent,
} as ActivityMessage;

const meta = {
  title: "Parity/A2UI Activity",
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Vue parity stories for built-in a2ui-surface activity fallback and slot precedence.",
      },
    },
  },
} satisfies Meta<{}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BuiltInRenderer: Story = {
  render: () => ({
    components: { A2UISurfaceActivityRenderer },
    setup() {
      return { sampleContent, activityMessage };
    },
    template: `
      <A2UISurfaceActivityRenderer
        :activity-type="activityMessage.activityType"
        :content="sampleContent"
        :message="activityMessage"
      />
    `,
  }),
};

/**
 * A2UI is enabled by passing a catalog to the provider; the generic
 * `#activity-message` slot still takes precedence over the built-in renderer.
 */
export const ChatSlotPrecedence: Story = {
  parameters: {
    copilotkit: {
      provider: { a2ui: { catalog: vueBasicCatalog } },
    } satisfies CopilotKitStoryParameters,
  },
  render: () => ({
    components: { CopilotChatMessageView },
    setup() {
      const messages: Message[] = [activityMessage];
      return { messages };
    },
    template: `
      <CopilotChatMessageView :messages="messages">
        <template #activity-message>
          <div class="story-panel">
            Generic slot overrides built-in A2UI fallback
          </div>
        </template>
      </CopilotChatMessageView>
    `,
  }),
};
