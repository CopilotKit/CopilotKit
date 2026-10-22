import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
// @ts-expect-error -- untyped .mjs build script shared with react-core's build:css
import { scopePreflight } from "../../../../../packages/react-core/scripts/scope-preflight.mjs";

const reactCoreSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/react-core/src/v2",
);

// Stories render react-core from source so component and CSS edits hot-reload.
// The published CSS scopes Tailwind's preflight under [data-copilotkit] after
// compilation; apply the same step here so Storybook shows what ships.
const scopeReactCorePreflight: Plugin = {
  name: "copilotkit:scope-preflight",
  transform(code, id) {
    const [file = ""] = id.split("?");
    if (!file.startsWith(reactCoreSrc) || !file.endsWith(".css")) return;
    return { code: scopePreflight(code), map: null };
  },
};

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: ["../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? []),
      tailwindcss(),
      scopeReactCorePreflight,
    ];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        {
          find: /^@copilotkit\/react-core\/v2\/styles\.css$/,
          replacement: `${reactCoreSrc}/index.css`,
        },
        {
          find: /^@copilotkit\/react-core\/v2\/(context|headless)$/,
          replacement: `${reactCoreSrc}/$1.ts`,
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
