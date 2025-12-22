import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  stories: ["../stories/**/*.stories.@(tsx|mdx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-themes"
  ],
  webpackFinal: async (cfg) => {
    // Suppress size warnings for development
    cfg.performance = {
      ...cfg.performance,
      maxAssetSize: 5000000, // 5MB
      maxEntrypointSize: 5000000, // 5MB
    };

    return cfg;
  },
};
export default config;
