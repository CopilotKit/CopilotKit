import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Enable Vitest globals so @testing-library/react's auto-cleanup hook
    // (`afterEach(cleanup)`) self-registers between tests.
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // CopilotKit's v2 entry side-effect-imports a CSS file. Vitest's default
    // Node loader can't handle .css; ask Vite to handle styles instead.
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\/react-core/],
      },
    },
  },
});
