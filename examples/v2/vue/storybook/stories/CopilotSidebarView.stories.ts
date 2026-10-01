import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotModalHeader, CopilotSidebarView } from "@copilotkit/vue";
import { reactHooksConversation, starterSuggestions } from "./support/fixtures";
import HostPage from "./support/HostPage.vue";

/**
 * `CopilotSidebarView` is the presentational sidebar shell: it takes messages
 * and callbacks as props instead of binding to an agent (`CopilotSidebar`
 * wires it up).
 */
const meta = {
  title: "UI/CopilotSidebarView",
  component: CopilotSidebarView,
  parameters: {
    // Not "fullscreen": its body margin reset would cancel the sidebar's page
    // push (see preview.css).
    layout: "none",
  },
  args: {
    autoScroll: true,
    defaultOpen: true,
    messages: reactHooksConversation,
  },
  render: (args) => ({
    components: { CopilotSidebarView, HostPage },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotSidebarView v-bind="args" />
      </HostPage>
    `,
  }),
} satisfies Meta<typeof CopilotSidebarView>;

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

export const CustomWidth: Story = {
  args: {
    width: 360,
  },
};

/** The `header` slot composes `CopilotModalHeader` with custom title and close button. */
export const CustomHeader: Story = {
  render: (args) => ({
    components: {
      HostPage,
      CopilotSidebarView,
      CopilotModalHeader,
      CopilotModalHeaderTitle: CopilotModalHeader.Title,
      CopilotModalHeaderCloseButton: CopilotModalHeader.CloseButton,
    },
    setup() {
      return { args };
    },
    template: `
      <HostPage>
        <CopilotSidebarView v-bind="args">
          <template #header>
            <CopilotModalHeader title="Workspace Copilot">
              <template #title-content="{ title: resolvedTitle }">
                <CopilotModalHeaderTitle>
                  <span style="display: block; white-space: nowrap; font-size: 1.125rem; font-weight: 600; letter-spacing: -0.015em; color: var(--foreground)">
                    {{ resolvedTitle }}
                  </span>
                  <span style="display: block; margin-top: 4px; white-space: nowrap; font-size: 0.75rem; font-weight: 400; color: var(--muted-foreground)">
                    Always-on teammate
                  </span>
                </CopilotModalHeaderTitle>
              </template>
              <template #close-button="{ onClose: close }">
                <CopilotModalHeaderCloseButton
                  style="color: var(--destructive-foreground)"
                  @click="close"
                />
              </template>
            </CopilotModalHeader>
          </template>
        </CopilotSidebarView>
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
