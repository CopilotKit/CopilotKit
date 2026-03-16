import type { StorybookConfig } from "@storybook/vue3-vite";
import vue from "@vitejs/plugin-vue";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/vue3-vite",
    options: {},
  },
  stories: ["../stories/**/*.stories.@(ts|mdx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  viteFinal: async (config) => {
    config.plugins = [...(config.plugins ?? []), vue()];

    config.build = {
      ...(config.build ?? {}),
      chunkSizeWarningLimit: 5000,
    };
    return config;
  },
};

export default config;
