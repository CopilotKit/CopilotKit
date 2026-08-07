import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    typecheck: {
      enabled: true,
      only: true,
      checker: "vue-tsc",
      tsconfig: "./tsconfig.type-tests.json",
      include: ["type-tests/**/*.test-d.ts"],
    },
  },
});
