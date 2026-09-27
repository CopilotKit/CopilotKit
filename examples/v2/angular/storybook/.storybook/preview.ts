import type { Decorator, Preview } from "@storybook/angular";
import { withThemeByClassName } from "@storybook/addon-themes";
import { provideCopilotKit } from "@copilotkit/angular";
import type { CopilotKitConfig } from "@copilotkit/angular";
import { StoryAgent } from "../stories/support/story-agent";
import type { StoryAgentOptions } from "../stories/support/story-agent";

/**
 * Per-story CopilotKit setup, read from `parameters.copilotkit`.
 * Set `parameters.copilotkit = false` for stories that provide their own
 * `provideCopilotKit(...)`.
 */
export interface CopilotKitStoryParameters {
  /** Options for the in-memory agent registered as `default`. */
  agent?: StoryAgentOptions;
  /** Extra `provideCopilotKit` config (tools, renderers, suggestions, ...). */
  config?: Partial<CopilotKitConfig>;
}

// Every story runs inside a real CopilotKit provider backed by a local
// StoryAgent, so components behave as they do in an app without needing a
// runtime or network. The Inspector is off: it's a dev tool, not part of the
// UI under review. Story-level `applicationConfig` providers come later and
// win, so a story can still override any of this.
const withCopilotKit: Decorator = (storyFn, context) => {
  const story = storyFn();
  const params = context.parameters["copilotkit"] as
    | CopilotKitStoryParameters
    | false
    | undefined;
  if (params === false) return story;

  return {
    ...story,
    applicationConfig: {
      ...story.applicationConfig,
      providers: [
        provideCopilotKit({
          agents: { default: new StoryAgent(params?.agent) },
          enableInspector: false,
          ...params?.config,
        }),
        ...(story.applicationConfig?.providers ?? []),
      ],
    },
  };
};

const preview: Preview = {
  parameters: {
    // Disable the backgrounds addon; the theme decorator owns the canvas.
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: { order: ["Foundations", "UI", "*"] },
    },
  },
  decorators: [
    withCopilotKit,
    withThemeByClassName({
      themes: {
        light: "", // default = no extra class
        dark: "dark", // adds class="dark" to <html> in the preview iframe
      },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
