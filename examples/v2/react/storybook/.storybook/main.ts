import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// Forward slashes, like the module ids Vite passes to `transform`, so the
// prefix check below also matches on Windows.
const reactCoreSrc = path
  .resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../packages/react-core/src/v2",
  )
  .split(path.sep)
  .join("/");
const coreStylesheet = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/core/src/styles/stylesheet.ts",
);

// Stories render react-core and the stylesheet from source so edits
// hot-reload. CSS edits in core's src/styles/css need
// `node scripts/generate-stylesheet.mjs` in packages/core.

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: ["../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        {
          find: /^@copilotkit\/react-core\/v2\/(context|headless)$/,
          replacement: `${reactCoreSrc}/$1.ts`,
        },
        {
          find: /^@copilotkit\/core\/styles$/,
          replacement: coreStylesheet,
        },
        {
          find: /^@copilotkit\/react-core\/v2$/,
          replacement: `${reactCoreSrc}/index.ts`,
        },
      ],
    };
    viteConfig.build = {
      ...viteConfig.build,
      chunkSizeWarningLimit: 5000,
    };
    return viteConfig;
  },
};

export default config;
