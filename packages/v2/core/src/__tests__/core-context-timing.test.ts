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
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
} from "./test-utils";

/**
 * Subclass that simulates the React adapter's behavior:
 * waitForPendingFrameworkUpdates flushes pending framework state so that
 * deferred context updates can complete before the follow-up agent run.
 *
 * In production, CopilotKitCoreReact calls flushSync() which forces React to
 * commit pending state synchronously, causing useLayoutEffect (useAgentContext)
 * to run immediately. Here we simulate the same net effect with setTimeout(0)
 * to keep this test dependency-free from React and react-dom.
 */
class CopilotKitCoreWithFrameworkFlush extends CopilotKitCore {
  async waitForPendingFrameworkUpdates(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("Event-loop yield mechanism for follow-up context reads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follow-up run reads stale context when no yield is present", async () => {
    // Use plain CopilotKitCore — no framework flush (base no-op)
    const core = new CopilotKitCore({});

    const initialId = core.addContext({
      description: "prefs",
      value: '{"spicy":true}',
    });

    const followUpContextValues: string[] = [];

    // Simulate a deferred context update (analogous to React's useEffect deferral):
    // the tool handler schedules the context change via setTimeout(0) rather than
    // applying it synchronously. In real React, setState() + useEffect produces
    // the same deferral via the React scheduler.
    const tool = {
      name: "updatePrefs",
      followUp: true,
      handler: async () => {
        // Deferred update via setTimeout(0), simulating React's useEffect deferral.
        // In production the deferral comes from React's scheduler, not a manual
        // setTimeout — see the React integration test for the real flow.
        setTimeout(() => {
          core.removeContext(initialId);
          core.addContext({ description: "prefs", value: '{"spicy":false}' });
        }, 0);
        return "updated";
      },
    };
    core.addTool(tool);

    const followUpMessage = createAssistantMessage({ content: "Done" });
    let callCount = 0;
    const agent = new MockAgent({
      newMessages: [createToolCallMessage("updatePrefs")],
      agentId: "test",
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    agent.runAgentCallback = (input: any) => {
      callCount++;
      if (callCount === 2) {
        // Capture context on the follow-up run
        const values = (input.context ?? []).map((c: any) => c.value);
        followUpContextValues.push(...values);
        agent.setNewMessages([followUpMessage]);
      }
    };

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
    // Without a yield, the deferred context update hasn't fired yet when
    // runAgent is called, so the follow-up sees the old value.
    expect(followUpContextValues).toContain('{"spicy":true}');
    expect(followUpContextValues).not.toContain('{"spicy":false}');
  });

  it("follow-up run sees fresh context when the framework flush yield is present", async () => {
    // Use the subclass that yields before the follow-up (mirrors CopilotKitCoreReact)
    const core = new CopilotKitCoreWithFrameworkFlush({});

    const initialId = core.addContext({
      description: "prefs",
      value: '{"spicy":true}',
    });

    const followUpContextValues: string[] = [];

    const tool = {
      name: "updatePrefs",
      followUp: true,
      handler: async () => {
        // Same deferred context update as above
        setTimeout(() => {
          core.removeContext(initialId);
          core.addContext({ description: "prefs", value: '{"spicy":false}' });
        }, 0);
        return "updated";
      },
    };
    core.addTool(tool);

    const followUpMessage = createAssistantMessage({ content: "Done" });
    let callCount = 0;
    const agent = new MockAgent({
      newMessages: [createToolCallMessage("updatePrefs")],
      agentId: "test",
    });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    agent.runAgentCallback = (input: any) => {
      callCount++;
      if (callCount === 2) {
        const values = (input.context ?? []).map((c: any) => c.value);
        followUpContextValues.push(...values);
        agent.setNewMessages([followUpMessage]);
      }
    };

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
    // The yield (setTimeout(0)) lets the deferred context update fire before
    // the follow-up run reads the context store, so the new value is visible.
    expect(followUpContextValues).toContain('{"spicy":false}');
    expect(followUpContextValues).not.toContain('{"spicy":true}');
  });
});
