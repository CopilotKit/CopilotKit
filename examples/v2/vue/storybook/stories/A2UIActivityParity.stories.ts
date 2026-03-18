import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { defineComponent, h, nextTick } from "vue";
import type { ActivityMessage, Message } from "@ag-ui/core";
import {
  A2UISurfaceActivityRenderer,
  A2UISurfaceActivityType,
  CopilotChatMessageView,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useCopilotKit,
} from "@copilotkitnext/vue";

const sampleContent = {
  operations: [
    {
      beginRendering: {
        surfaceId: "story-surface",
        root: "root",
      },
    },
    {
      surfaceUpdate: {
        surfaceId: "story-surface",
        components: [{ id: "root", text: { literalString: "Hello from A2UI" } }],
      },
    },
  ],
};

const meta = {
  title: "Parity/A2UI Activity",
  parameters: {
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
      return {
        sampleContent,
      };
    },
    template: `
      <div style="padding: 12px; max-width: 720px;">
        <A2UISurfaceActivityRenderer
          activity-type="a2ui-surface"
          :content="sampleContent"
          :message="{ id: 'story-msg', role: 'activity', activityType: 'a2ui-surface', content: sampleContent }"
        />
      </div>
    `,
  }),
};

export const ChatSlotPrecedence: Story = {
  render: () => ({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      const messages: Message[] = [
        {
          id: "story-activity",
          role: "activity",
          activityType: A2UISurfaceActivityType,
          content: sampleContent,
        } as ActivityMessage,
      ];

      const EnableRuntimeA2UI = defineComponent({
        setup() {
          const { copilotkit } = useCopilotKit();
          const enable = async () => {
            Object.defineProperty(copilotkit.value as object, "a2uiEnabled", {
              configurable: true,
              get: () => true,
            });
            const testAccess = copilotkit.value as unknown as {
              notifySubscribers: (
                handler: (subscriber: {
                  onRuntimeConnectionStatusChanged?: () => void | Promise<void>;
                }) => void | Promise<void>,
                errorMessage: string,
              ) => Promise<void>;
            };
            await testAccess.notifySubscribers(
              (subscriber) => subscriber.onRuntimeConnectionStatusChanged?.(),
              "storybook enable a2ui",
            );
            await nextTick();
          };

          void enable();
          return () => null;
        },
      });

      return { messages, EnableRuntimeA2UI };
    },
    template: `
      <div style="padding: 12px; max-width: 720px;">
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <EnableRuntimeA2UI />
          <CopilotChatConfigurationProvider thread-id="story-thread" agent-id="default">
            <CopilotChatMessageView :messages="messages">
              <template #activity-message>
                <div style="padding: 8px; border: 1px solid #d1d5db; border-radius: 8px;">
                  Generic slot overrides built-in A2UI fallback
                </div>
              </template>
            </CopilotChatMessageView>
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </div>
    `,
  }),
};
