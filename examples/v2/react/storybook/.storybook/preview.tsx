import React, { useMemo } from "react";
import type { Decorator, Preview } from "@storybook/react-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  CopilotKitStyles,
} from "@copilotkit/react-core/v2";
import type { CopilotKitProviderProps } from "@copilotkit/react-core/v2";
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
}

// Every story runs inside a real CopilotKitProvider backed by a local
// StoryAgent, so components behave as they do in an app without needing a
// runtime. The Inspector is off: it's a dev tool, not part of the UI under review.
const withCopilotKit: Decorator = (Story, context) => {
  const params = context.parameters.copilotkit as
    | CopilotKitStoryParameters
    | false
    | undefined;
  const agentOptions = params ? params.agent : undefined;
  const agent = useMemo(() => new StoryAgent(agentOptions), [agentOptions]);

  // Stories often render a single part (an input, a message) without
  // CopilotChat, which is what normally renders the styles.
  if (params === false) {
    return (
      <>
        <CopilotKitStyles />
        <Story />
      </>
    );
  }

  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={{ default: agent }}
      enableInspector={false}
      {...params?.provider}
    >
      <CopilotChatConfigurationProvider
        threadId={params?.threadId ?? context.id}
      >
        <CopilotKitStyles />
        <Story />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
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
