import { defineComponent } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Minus, MessageCirclePlus } from "lucide-vue-next";
import {
  CopilotChatConfigurationProvider,
  CopilotChatToggleButton,
  useCopilotChatConfiguration,
} from "@copilotkitnext/vue";

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
    <div class="flex flex-col items-center gap-3">
      <CopilotChatToggleButton :disabled="disabled">
        <template v-if="customIcons" #open-icon="{ iconClass }">
          <MessageCirclePlus :class="[iconClass, 'text-emerald-400']" :stroke-width="1.5" />
        </template>
        <template v-if="customIcons" #close-icon="{ iconClass }">
          <Minus :class="[iconClass, 'text-rose-400']" :stroke-width="2" />
        </template>
      </CopilotChatToggleButton>
      <span class="text-sm text-muted-foreground">
        {{ configuration?.isModalOpen ? "Chat is open" : "Chat is closed" }}
      </span>
    </div>
  `,
});

const meta = {
  title: "UI/CopilotChatToggleButton",
  component: CopilotChatToggleButton,
  parameters: {
    layout: "centered",
  },
  render: (args) => ({
    components: {
      CopilotChatConfigurationProvider,
      StatePreview,
    },
    setup() {
      return { args };
    },
    template: `
      <CopilotChatConfigurationProvider thread-id="storybook-toggle-button">
        <StatePreview :disabled="Boolean(args.disabled)" :custom-icons="Boolean(args.customIcons)" />
      </CopilotChatConfigurationProvider>
    `,
  }),
} satisfies Meta<typeof CopilotChatToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCustomIcons: Story = {
  render: () => ({
    components: {
      CopilotChatConfigurationProvider,
      StatePreview,
    },
    template: `
      <CopilotChatConfigurationProvider thread-id="storybook-toggle-button-custom-icons">
        <StatePreview :custom-icons="true" />
      </CopilotChatConfigurationProvider>
    `,
  }),
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
