import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Allow react/ files to import from the root entry during tests
      "@copilotkit/markdown-renderer": resolve(__dirname, "src/index.ts"),
      // react-native uses Flow syntax that vite/rollup cannot parse.
      // Redirect to a minimal stub so import analysis succeeds during tests.
      // Individual tests can still override via vi.mock("react-native", ...).
      "react-native": resolve(__dirname, "src/react-native/__mocks__/react-native.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});
