import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Unit tests only; Playwright owns e2e/.
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // Let vite TRANSFORM the CopilotKit packages instead of externalising
        // them to Node's ESM loader.
        //
        // On 1.x, `src/app/layout.tsx` did
        // `import "@copilotkit/react-core/v2/styles.css"` (2.0 needs no
        // stylesheet import, so it is gone), and any test that transitively
        // reached that module pulled the stylesheet in with it. While this app
        // consumed the packages as `workspace:*` the file resolved inside the
        // workspace and vite handled it; installing them from npm moves it
        // under `node_modules/.pnpm/`, which vitest externalises by default,
        // and Node then throws `TypeError: Unknown file extension ".css"`. It
        // took out 16 suites at once — every one that renders a page or a
        // skin — while the failure itself named a stylesheet nobody had
        // touched. Kept: the 2.0 packages are transformed the same way.
        inline: [/@copilotkit\//],
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
