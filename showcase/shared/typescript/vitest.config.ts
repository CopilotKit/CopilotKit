import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "showcase/shared/typescript",
    include: ["tools/__tests__/**/*.test.ts"],
  },
});
