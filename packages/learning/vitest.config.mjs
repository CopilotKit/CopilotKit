import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  define: { __LEARNING_VERSION__: JSON.stringify(version) },
  test: {
    environment: "./src/__tests__/vitest-environment.mjs",
    include: ["src/**/__tests__/**/*.test.ts"],
    reporters: [["default", { summary: false }]],
  },
});
