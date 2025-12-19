import type { StorybookConfig } from "@storybook/angular";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/angular",
    options: {},
  },
  stories: ["../stories/**/*.stories.@(ts|tsx|mdx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
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