import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotModalHeader, CopilotSidebarView } from "@copilotkitnext/vue";
import CopilotStoryLayout from "./CopilotStoryLayout.vue";

const meta = {
  title: "UI/CopilotSidebarView",
  component: CopilotSidebarView,
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => ({
    components: {
      CopilotStoryLayout,
      CopilotSidebarView,
    },
    setup() {
      return { args };
    },
    template: `
      <CopilotStoryLayout>
        <CopilotSidebarView v-bind="args" />
      </CopilotStoryLayout>
    `,
  }),
} satisfies Meta<typeof CopilotSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    autoScroll: true,
  },
};

export const CustomHeader: Story = {
  render: (args) => ({
    components: {
      CopilotStoryLayout,
      CopilotSidebarView,
      CopilotModalHeader,
      CopilotModalHeaderTitle: CopilotModalHeader.Title,
      CopilotModalHeaderCloseButton: CopilotModalHeader.CloseButton,
    },
    setup() {
      return { args };
    },
    template: `
      <CopilotStoryLayout>
        <CopilotSidebarView v-bind="args">
          <template #header>
            <CopilotModalHeader title="Workspace Copilot">
              <template #title-content="{ title: resolvedTitle }">
                <CopilotModalHeaderTitle class="text-lg font-semibold tracking-tight text-foreground">
                  <span>{{ resolvedTitle }}</span>
                  <span class="mt-1 block text-xs font-normal text-muted-foreground">
                    Always-on teammate
                  </span>
                </CopilotModalHeaderTitle>
              </template>

              <template #close-button="{ onClose: close }">
                <CopilotModalHeaderCloseButton
                  class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  @click="close"
                />
              </template>
            </CopilotModalHeader>
          </template>
        </CopilotSidebarView>
      </CopilotStoryLayout>
    `,
  }),
};
