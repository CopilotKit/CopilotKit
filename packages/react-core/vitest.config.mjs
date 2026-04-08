import { defineConfig } from "vitest/config";
import { createRequire } from "module";
import path from "path";

// Force a single React copy — linked packages like @a2ui/react may have
// their own node_modules/react (v18) which conflicts with the workspace
// React (v19). Deduplicating here prevents "older version of React" errors.
const require = createRequire(import.meta.url);
const reactDir = path.dirname(require.resolve("react/package.json"));
const reactDomDir = path.dirname(require.resolve("react-dom/package.json"));

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
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
      "react/jsx-runtime": path.join(reactDir, "jsx-runtime.js"),
      "react/jsx-dev-runtime": path.join(reactDir, "jsx-dev-runtime.js"),
      "react-dom": path.join(reactDomDir, "index.js"),
      react: path.join(reactDir, "index.js"),
    },
  },
});
