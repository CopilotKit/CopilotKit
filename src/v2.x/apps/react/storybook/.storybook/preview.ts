import type { Preview } from "@storybook/react-webpack5";
import { withThemeByClassName } from "@storybook/addon-themes";
import "@copilotkitnext/react/styles.css";
import "./preview.css";

const preview: Preview = {
  parameters: {
    // Disable the backgrounds addon to avoid conflicts with dark mode
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      // Canvas (bottom) code panel behavior
      canvas: { sourceState: "shown" }, // Show source code by default
      // Enable the separate Code panel in Docs tab
      codePanel: true,
      // Configure source display
      source: {
        type: "dynamic", // Update snippet as args/Controls change
      },
    },
  },
  decorators: [
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
