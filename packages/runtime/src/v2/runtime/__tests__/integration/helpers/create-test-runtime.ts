import { CopilotRuntime } from "../../../core/runtime";
import { createFakeAgent, createTestRunner } from "./test-agent";

/**
 * Creates a CopilotRuntime configured with a fake agent for testing.
 * No API keys required.
 */
export function createTestRuntime(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
) {
  return new CopilotRuntime({
    agents: { default: createFakeAgent(opts) as any },
    runner: createTestRunner(),
  });
}
