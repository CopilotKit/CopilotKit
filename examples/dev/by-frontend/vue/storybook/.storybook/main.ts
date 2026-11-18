import type { StorybookConfig } from "@storybook/vue3-vite";
import vue from "@vitejs/plugin-vue";

const storybookConfig: StorybookConfig = {
  framework: {
    name: "@storybook/vue3-vite",
    options: {},
  },
  stories: ["../stories/**/*.stories.@(ts|mdx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), vue()];

    viteConfig.build = {
      ...viteConfig.build,
      chunkSizeWarningLimit: 5000,
    };
    return viteConfig;
  },
};

export default storybookConfig;
