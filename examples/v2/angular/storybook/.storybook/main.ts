import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/angular";

const config: StorybookConfig = {
  framework: {
    name: getAbsolutePath("@storybook/angular"),
    options: {},
  },
  stories: ["../stories/**/*.stories.@(ts|tsx|mdx)"],
  addons: [
    getAbsolutePath("@storybook/addon-themes"),
    getAbsolutePath("@storybook/addon-docs"),
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

function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
