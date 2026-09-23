import type { StorybookConfig } from "@storybook/nextjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },

  stories: ["../stories/**/*.stories.@(tsx|mdx)"],

  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],

  webpackFinal: async (config) => {
    // 1. Correct directory math: 5 hops up to the monorepo root
    const reactCorePkgPath = path.resolve(
      __dirname,
      "../../../../../packages/react-core",
    );

    console.log("React core package path:", reactCorePkgPath);

    return {
      ...config,

      performance: {
        ...config.performance,
        maxAssetSize: 5000000,
        maxEntrypointSize: 5000000,
      },

      resolve: {
        ...config.resolve,

        symlinks: true,

        alias: {
          ...config.resolve?.alias,

          // 2. Exact match ($) AND pointing directly to the TypeScript source
          // This bypasses the dist/ folder entirely, killing the concurrency race condition.
          "@copilotkit/react-core/v2$": path.join(
            reactCorePkgPath,
            "src/v2/index.ts",
          ),

          // 3. Exact match ($) for styles
          // CSS is safe to read from dist/source because it is not parsed by docgen.
          "@copilotkit/react-core/v2/styles.css": path.join(
            reactCorePkgPath,
            "src/v2/styles/globals.css",
          ),

          // 4. NEW FIX: Point core directly to source to bypass dist/ docgen AST crash
          "@copilotkit/core$": path.resolve(
            __dirname,
            "../../../../../packages/core/src/index.ts",
          ),
        },
      },

      module: {
        ...config.module,

        rules: (config.module?.rules || []).map((rule) => {
          if (
            typeof rule === "object" &&
            rule !== null &&
            "test" in rule &&
            rule.test instanceof RegExp &&
            rule.test.test(".tsx")
          ) {
            return {
              ...rule,
            };
          }

          return rule;
        }),
      },
    };
  },
};

export default config;
