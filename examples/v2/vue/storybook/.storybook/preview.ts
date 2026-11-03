import type { Preview } from "@storybook/vue3-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import { CopilotKitStyles } from "@copilotkit/vue";
import "./preview.css";

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
      source: {
        type: "dynamic",
      },
    },
  },
  decorators: [
    // Stories often render a single part (an input, a message) without
    // CopilotChat, which is what normally renders the styles.
    (story) => ({
      components: { story, CopilotKitStyles },
      template: "<CopilotKitStyles /><story />",
    }),
    withThemeByClassName({
      themes: {
        light: "",
        dark: "dark",
      },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
