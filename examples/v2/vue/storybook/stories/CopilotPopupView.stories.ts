import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotModalHeader, CopilotPopupView } from "@copilotkit/vue";
import { reactHooksConversation, starterSuggestions } from "./support/fixtures";
import HostPage from "./support/HostPage.vue";

/**
 * `CopilotPopupView` is the presentational popup shell: it takes messages and
 * callbacks as props instead of binding to an agent (`CopilotPopup` wires it
 * up).
 */
const meta = {
  title: "UI/CopilotPopupView",
  component: CopilotPopupView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    messages: reactHooksConversation,
    defaultOpen: true,
    clickOutsideToClose: false,
  },
  render: (args) => ({
    components: { CopilotPopupView, HostPage },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotPopupView v-bind="args" />
      </HostPage>
    `,
  }),
} satisfies Meta<typeof CopilotPopupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No messages: the welcome screen, with starter cards stacked in one column. */
export const WelcomeScreen: Story = {
  args: {
    messages: [],
    suggestions: starterSuggestions,
  },
};

export const CustomSize: Story = {
  args: {
    width: 360,
    height: 480,
  },
};

/** The `header` slot composes `CopilotModalHeader` with a subtitle. */
export const CustomHeader: Story = {
  render: (args) => ({
    components: {
      HostPage,
      CopilotPopupView,
      CopilotModalHeader,
      CopilotModalHeaderTitle: CopilotModalHeader.Title,
    },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotPopupView v-bind="args">
          <template #header>
            <CopilotModalHeader title="Acme Assistant">
              <template #title-content="{ title: resolvedTitle }">
                <CopilotModalHeaderTitle>
                  <span style="display: block; white-space: nowrap">{{ resolvedTitle }}</span>
                  <span style="display: block; margin-top: 4px; white-space: nowrap; font-size: 0.75rem; font-weight: 400; color: var(--muted-foreground)">
                    Replies in a few seconds
                  </span>
                </CopilotModalHeaderTitle>
              </template>
            </CopilotModalHeader>
          </template>
        </CopilotPopupView>
      </HostPage>
    `,
  }),
};

/** Closed: only the toggle button shows. */
export const Closed: Story = {
  args: {
    defaultOpen: false,
  },
};
