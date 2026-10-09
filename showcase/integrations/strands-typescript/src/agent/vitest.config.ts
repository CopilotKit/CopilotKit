import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Co-located agent-process unit tests. The integration's broader suite is
    // Playwright e2e (`test:e2e` at the integration root); this config scopes
    // vitest to the agent package's own unit tests, which resolve the agent's
    // own node_modules (openai / @strands-agents) rather than the Next app's.
    include: ["*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
});
