import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Expo modules are not installed in the monorepo (they live in the
      // user's RN app). Point them at lightweight stubs so Vite's import
      // analysis doesn't fail. Tests override these via vi.mock().
      "expo-document-picker": path.resolve(
        __dirname,
        "src/__tests__/__mocks__/expo-document-picker.ts",
      ),
      "expo-file-system": path.resolve(
        __dirname,
        "src/__tests__/__mocks__/expo-file-system.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/__tests__/setup.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    server: {
      deps: {
        inline: [/@copilotkit/],
        // react-native uses Flow syntax that Vitest/Rollup can't parse outside
        // of Metro. Exclude it so the test runner doesn't attempt to bundle it.
        external: ["react-native"],
      },
    },
  },
});
