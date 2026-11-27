import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests for the Worker's framework-free modules (header forwarding,
    // the interrupt resume shim, the tools and the A2UI tool). The agent
    // classes import the Agents SDK, which needs workerd; the D6 probes cover
    // them end to end.
    include: ["*.test.ts"],
    environment: "node",
  },
});
