import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    maxWorkers: 2,
    env: { COPILOTKIT_TELEMETRY_DISABLED: "true" },
  },
});
