import { defineComponent } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Minus, MessageCirclePlus } from "lucide-vue-next";
import {
  CopilotChatToggleButton,
  useCopilotChatConfiguration,
} from "@copilotkit/vue";
import type { CopilotKitStoryParameters } from "../.storybook/preview";

const StatePreview = defineComponent({
  name: "CopilotChatToggleButtonStoryPreview",
  components: {
    CopilotChatToggleButton,
    MessageCirclePlus,
    Minus,
  },
  props: {
    disabled: {
      type: Boolean,
      default: false,
    },
    customIcons: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const configuration = useCopilotChatConfiguration();
    return { configuration };
  },
  template: `
    <div style="display: flex; flex-direction: column; align-items: center; gap: 12px">
      <CopilotChatToggleButton :disabled="disabled">
        <template v-if="customIcons" #open-icon="{ iconClass }">
          <MessageCirclePlus :class="iconClass" style="color: oklch(0.77 0.15 163)" :stroke-width="1.5" />
        </template>
        <template v-if="customIcons" #close-icon="{ iconClass }">
          <Minus :class="iconClass" style="color: oklch(0.71 0.17 13)" :stroke-width="2" />
        </template>
      </CopilotChatToggleButton>
      <p class="story-caption">
        {{ configuration?.isModalOpen ? "Chat is open" : "Chat is closed" }}
      </p>
    </div>
  `,
});

const meta = {
  title: "UI/CopilotChatToggleButton",
  component: CopilotChatToggleButton,
  parameters: {
    layout: "centered",
    // Give the chat configuration modal state so the button drives it.
    copilotkit: {
      isModalDefaultOpen: false,
    } satisfies CopilotKitStoryParameters,
  },
  render: (args) => ({
    components: { StatePreview },
    setup() {
      return { args };
    },
    template: `
      <StatePreview :disabled="Boolean(args.disabled)" />
    `,
  }),
} satisfies Meta<typeof CopilotChatToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCustomIcons: Story = {
  render: () => ({
    components: { StatePreview },
    template: `<StatePreview :custom-icons="true" />`,
  }),
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
