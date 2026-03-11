import type { Preview } from "@storybook/vue3-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import "@copilotkitnext/vue/styles.css";
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
