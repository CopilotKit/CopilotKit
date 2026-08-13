import { defineConfig } from "vitest/config";

// Node 25+ installs a Web Storage stub before jsdom. That stub has no
// getItem/setItem, so inspector hydrate throws during react-core tests.
// Same flag as packages/web-inspector/vitest.config.ts.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const needsNoExperimentalWebstorage =
  nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 4);

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    poolOptions: {
      forks: {
        execArgv: needsNoExperimentalWebstorage
          ? ["--no-experimental-webstorage"]
          : [],
      },
      threads: {
        execArgv: needsNoExperimentalWebstorage
          ? ["--no-experimental-webstorage"]
          : [],
      },
    },
    include: [
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    globalSetup: ["./src/v2/__tests__/globalSetup.ts"],
    setupFiles: ["./src/setupTests.ts", "./src/v2/__tests__/setup.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    server: {
      deps: {
        inline: ["react-markdown", "streamdown", "@copilotkit"],
      },
    },
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src/v2", import.meta.url).pathname,
    },
  },
});
