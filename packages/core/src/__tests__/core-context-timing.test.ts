/**
 * Unit tests for the event-loop yield mechanism that guards against stale
 * context in follow-up agent runs.
 *
 * Background: when a frontend tool handler updates React state, the context
 * store is refreshed asynchronously (React defers useEffect to a later
 * scheduler task). Without yielding before the follow-up runAgent call, the
 * core reads stale context.
 *
 * These tests verify the yield mechanism itself using a simplified simulation:
 * the tool handler schedules a context update via setTimeout(0) to represent
 * what React's deferred useEffect would do. This tests Node.js FIFO macrotask
 * ordering, not React's rendering pipeline directly.
 *
 * For an integration-level test that exercises real React rendering, see
 * packages/v2/react/src/hooks/__tests__/use-agent-context-timing.e2e.test.tsx
 */
import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
} from "./test-utils";

/** Yield one macrotask, the way a framework scheduler defers its updates. */
function yieldToScheduler() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Subclass that simulates an adapter that overrides
 * waitForPendingFrameworkUpdates, so deferred context updates can complete
 * before the follow-up agent run.
 */
class CopilotKitCoreWithFrameworkFlush extends CopilotKitCore {
  async waitForPendingFrameworkUpdates(): Promise<void> {
    await yieldToScheduler();
  }
}

/**
 * Run an agent whose first turn calls a tool. The tool handler changes the
 * context one macrotask later (like React's deferred effects). Returns the
 * context values the follow-up run received.
 */
async function followUpContextAfterDeferredUpdate(core: CopilotKitCore) {
  const initialId = core.addContext({
    description: "prefs",
    value: '{"spicy":true}',
  });
  core.addTool({
    name: "updatePrefs",
    followUp: true,
    handler: async () => {
      setTimeout(() => {
        core.removeContext(initialId);
        core.addContext({ description: "prefs", value: '{"spicy":false}' });
      }, 0);
      return "updated";
    },
  });

  const followUpContextValues: string[] = [];
  const agent = new MockAgent({
    newMessages: [createToolCallMessage("updatePrefs")],
    agentId: "test",
  });
  agent.runAgentCallback = (input: RunAgentInput) => {
    if (agent.runAgentCalls.length !== 2) return;
    followUpContextValues.push(...input.context.map((entry) => entry.value));
    agent.setNewMessages([createAssistantMessage({ content: "Done" })]);
  };
  // MockAgent implements only the AbstractAgent surface core uses here; it is
  // not a subclass, so it needs this one cast.
  const asAgent = agent as unknown as AbstractAgent;
  core.addAgent__unsafe_dev_only({ id: "test", agent: asAgent });

  await core.runAgent({ agent: asAgent });

  expect(agent.runAgentCalls).toHaveLength(2);
  return followUpContextValues;
}

describe("Event-loop yield mechanism for follow-up context reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follow-up run reads stale context when no yield is present", async () => {
    const values = await followUpContextAfterDeferredUpdate(
      new CopilotKitCore({}),
    );

    expect(values).toEqual(['{"spicy":true}']);
  });

  it("follow-up run sees fresh context when a subclass overrides the wait", async () => {
    const values = await followUpContextAfterDeferredUpdate(
      new CopilotKitCoreWithFrameworkFlush({}),
    );

    expect(values).toEqual(['{"spicy":false}']);
  });

  it("follow-up run sees fresh context when ɵwaitForFrameworkUpdates is passed", async () => {
    const waitForFrameworkUpdates = vi.fn(yieldToScheduler);

    const values = await followUpContextAfterDeferredUpdate(
      new CopilotKitCore({ ɵwaitForFrameworkUpdates: waitForFrameworkUpdates }),
    );

    expect(values).toEqual(['{"spicy":false}']);
    expect(waitForFrameworkUpdates).toHaveBeenCalledTimes(1);
  });
});
