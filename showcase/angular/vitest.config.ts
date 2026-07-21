import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "server/**/*.test.ts",
      "src/app/cell-context.test.ts",
    ],
  },
});
