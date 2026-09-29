import type { Decorator, Preview } from "@storybook/vue3-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/vue";
import type { CopilotKitProviderProps } from "@copilotkit/vue";
import "@copilotkit/vue/styles.css";
import "./preview.css";
import { StoryAgent } from "../stories/support/story-agent";
import type { StoryAgentOptions } from "../stories/support/story-agent";

/**
 * Per-story CopilotKit setup, read from `parameters.copilotkit`.
 * Set `parameters.copilotkit = false` for stories that render their own provider.
 */
export interface CopilotKitStoryParameters {
  agent?: StoryAgentOptions;
  provider?: Partial<CopilotKitProviderProps>;
  threadId?: string;
  isModalDefaultOpen?: boolean;
}

// Every story runs inside a real CopilotKitProvider backed by a local
// StoryAgent, so components behave as they do in an app without needing a
// runtime. The Inspector is off: it's a dev tool, not part of the UI under review.
const withCopilotKit: Decorator = (story, context) => {
  const params = context.parameters.copilotkit as
    | CopilotKitStoryParameters
    | false
    | undefined;

  return {
    components: { story, CopilotKitProvider, CopilotChatConfigurationProvider },
    setup() {
      return {
        enabled: params !== false,
        agents: { default: new StoryAgent(params ? params.agent : undefined) },
        providerProps: (params && params.provider) || {},
        threadId: (params && params.threadId) || `story-${context.id}`,
        isModalDefaultOpen: params ? params.isModalDefaultOpen : undefined,
      };
    },
    template: `
      <CopilotKitProvider
        v-if="enabled"
        :agents__unsafe_dev_only="agents"
        :enable-inspector="false"
        v-bind="providerProps"
      >
        <CopilotChatConfigurationProvider
          :thread-id="threadId"
          :has-explicit-thread-id="false"
          :is-modal-default-open="isModalDefaultOpen"
        >
          <story />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
      <story v-else />
    `,
  };
};

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      canvas: { sourceState: "shown" },
      codePanel: true,
      source: { type: "dynamic" },
    },
    options: {
      storySort: { order: ["Foundations", "UI", "*"] },
    },
  },
  decorators: [
    withCopilotKit,
    withThemeByClassName({
      themes: { light: "", dark: "dark" },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
