import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Minus } from "lucide-vue-next";
import { CopilotModalHeader } from "@copilotkit/vue";

/**
 * The header used by `CopilotPopupView` and `CopilotSidebarView`. Its title
 * defaults to the `modalHeaderTitle` label; the close button closes the
 * surrounding modal.
 */
const meta = {
  title: "UI/CopilotModalHeader",
  component: CopilotModalHeader,
  decorators: [
    (story) => ({
      components: { story },
      template: `
        <div style="display: flex; min-height: 320px; align-items: flex-start; justify-content: center; padding: 40px">
          <div
            data-copilotkit
            style="width: 100%; max-width: 28rem; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05)"
          >
            <story />
            <div style="height: 160px" />
          </div>
        </div>
      `,
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => ({
    components: { CopilotModalHeader },
    setup() {
      return { args };
    },
    template: `<CopilotModalHeader v-bind="args" />`,
  }),
} satisfies Meta<typeof CopilotModalHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomTitle: Story = {
  args: {
    title: "Acme Assistant",
  },
};

/** The `close-button` slot swaps in a minimize control. */
export const CustomCloseButton: Story = {
  args: {
    title: "Acme Assistant",
  },
  render: (args) => ({
    components: { CopilotModalHeader, Minus },
    setup() {
      return { args };
    },
    template: `
      <CopilotModalHeader v-bind="args">
        <template #close-button="{ onClose }">
          <button type="button" class="story-icon-button" aria-label="Minimize" @click="onClose">
            <Minus :size="16" aria-hidden="true" />
          </button>
        </template>
      </CopilotModalHeader>
    `,
  }),
};

/** The `layout` slot re-arranges the header while keeping the bound title and close handler. */
export const CustomLayout: Story = {
  args: {
    title: "Acme Assistant",
  },
  render: (args) => ({
    components: {
      CopilotModalHeader,
      CopilotModalHeaderTitle: CopilotModalHeader.Title,
      CopilotModalHeaderCloseButton: CopilotModalHeader.CloseButton,
    },
    setup() {
      return { args };
    },
    template: `
      <CopilotModalHeader v-bind="args">
        <template #layout="{ title, onClose }">
          <div style="display: flex; width: 100%; align-items: center; gap: 12px">
            <div style="width: 28px; height: 28px; flex-shrink: 0; border-radius: 999px; background: var(--primary)" />
            <div style="min-width: 0; flex: 1; text-align: left">
              <CopilotModalHeaderTitle>{{ title }}</CopilotModalHeaderTitle>
            </div>
            <CopilotModalHeaderCloseButton @click="onClose" />
          </div>
        </template>
      </CopilotModalHeader>
    `,
  }),
};
