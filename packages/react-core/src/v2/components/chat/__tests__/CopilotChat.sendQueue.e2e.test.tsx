import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";
import type { Suggestion } from "@copilotkit/core";
import { MockRunLifecycleAgent } from "../../../__tests__/utils/test-helpers";

/**
 * E2E tests for the per-agent send-serialization queue in CopilotChat.
 *
 * These reproduce the four event-timing races rooted in
 * `intelligence-agent.ts`, where `activeRunCompletionPromise` is assigned only
 * AFTER `await onInitialize` — so a bare `await copilotkit.runAgent()` in the
 * send path does NOT serialize a send against the prior run's full lifecycle.
 *
 * The Subject-based MockStepwiseAgent cannot reproduce these because it has no
 * controllable gap between "run started" and "run completed" at the
 * runAgent-promise level. {@link MockRunLifecycleAgent} overrides `runAgent`
 * with independently controllable start/completion gates and records
 * invocation order + concurrency.
 *
 * The send handlers are captured off the chat view slot and invoked directly,
 * which is the faithful reproduction: the races fire on rapid PROGRAMMATIC
 * sends (e.g. suggestion selection, or sends issued before `isRunning`
 * propagates to disable the input). Driving through the textbox Enter key would
 * instead exercise the input's separate `isProcessing` Enter-gate, which is a
 * different concern and not what the queue fixes.
 *
 * RED (current master, no queue): each handler does a bare
 * `await copilotkit.runAgent()`, so two rapid sends BOTH call `runAgent`
 * before the first completes → maxConcurrentRuns >= 2.
 * GREEN (with queue): the 2nd send awaits the 1st run's completion handle, so
 * maxConcurrentRuns === 1 and runs are strictly ordered.
 *
 * Harness note: the queue produces microtask/async state updates as runs
 * settle. Every send and gate-open is wrapped in `await act(async () => { ...;
 * await tick(); })` so React flushes the resulting re-render INSIDE an act
 * scope. A trailing update firing outside act wedges the renderer for the next
 * test, which is why we avoid `waitFor` (it polls outside act) and always tick
 * via a real macrotask.
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Run `fn` then flush microtasks + one macrotask, all inside an act scope. */
async function actTick(fn?: () => void): Promise<void> {
  await act(async () => {
    fn?.();
    await tick();
  });
}

interface CapturedHandlers {
  onSubmitMessage?: (value: string) => void;
  onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
}

/**
 * A chatView slot that captures the send handlers CopilotChat passes down, so
 * the test can invoke them directly (bypassing the input's Enter-gate, which is
 * an orthogonal concern).
 */
function makeCaptureView(sink: CapturedHandlers) {
  return function CaptureView(props: {
    onSubmitMessage?: (value: string) => void;
    onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
  }) {
    sink.onSubmitMessage = props.onSubmitMessage;
    sink.onSelectSuggestion = props.onSelectSuggestion;
    return <div data-testid="capture-view" />;
  };
}

function renderChat(
  agents: Record<string, MockRunLifecycleAgent>,
  agentId: string,
  sink: CapturedHandlers,
) {
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={agents}>
      <CopilotChatConfigurationProvider agentId={agentId} threadId="t">
        <div style={{ height: 400 }}>
          <CopilotChat
            agentId={agentId}
            welcomeScreen={false}
            chatView={makeCaptureView(sink) as any}
          />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

describe("CopilotChat send queue — race reproduction (E2E)", () => {
  it("race1: 2nd send waits for 1st run's COMPLETION, not just RUN_STARTED", async () => {
    const agent = new MockRunLifecycleAgent();
    const run1 = agent.enqueueRun();
    const run2 = agent.enqueueRun();
    const sink: CapturedHandlers = {};
    renderChat({ default: agent }, "default", sink);
    await actTick();
    expect(sink.onSubmitMessage).toBeDefined();

    // Send #1 — start it (RUN_STARTED-equiv) but hold completion open.
    await actTick(() => sink.onSubmitMessage!("first"));
    await actTick(() => run1.gateRunStarted.resolve());

    // Send #2 while run #1 is started-but-not-completed.
    await actTick(() => sink.onSubmitMessage!("second"));
    await actTick(() => run2.gateRunStarted.resolve());

    // With completion-gating, run #2 must NOT have started while run #1 is
    // still in flight. (RED: no queue → both ran → maxConcurrentRuns === 2.)
    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.length).toBe(1);

    // Complete run #1 → run #2 is released.
    await actTick(() => run1.gateCompletion.resolve());
    expect(agent.runLog.length).toBe(2);
    await actTick(() => run2.gateCompletion.resolve());

    expect(agent.concurrentRuns).toBe(0);
    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog[0].messageContents).toContain("first");
    expect(agent.runLog[1].messageContents).toContain("second");
  });

  it("race2: a 3rd send arriving between start and completion stays serialized", async () => {
    const agent = new MockRunLifecycleAgent();
    const r1 = agent.enqueueRun();
    const r2 = agent.enqueueRun();
    const r3 = agent.enqueueRun();
    const sink: CapturedHandlers = {};
    renderChat({ default: agent }, "default", sink);
    await actTick();
    expect(sink.onSubmitMessage).toBeDefined();

    await actTick(() => sink.onSubmitMessage!("one"));
    await actTick(() => r1.gateRunStarted.resolve());

    // Fire #2 and #3 between #1's start and completion.
    await actTick(() => sink.onSubmitMessage!("two"));
    await actTick(() => sink.onSubmitMessage!("three"));
    await actTick(() => {
      r2.gateRunStarted.resolve();
      r3.gateRunStarted.resolve();
    });

    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.length).toBe(1);

    await actTick(() => r1.gateCompletion.resolve());
    expect(agent.runLog.length).toBe(2);
    await actTick(() => r2.gateCompletion.resolve());
    expect(agent.runLog.length).toBe(3);
    await actTick(() => r3.gateCompletion.resolve());

    expect(agent.concurrentRuns).toBe(0);
    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(agent.runLog[0].messageContents).toContain("one");
    expect(agent.runLog[1].messageContents).toContain("two");
    expect(agent.runLog[2].messageContents).toContain("three");
  });

  it("race3: switching agents mid-send uses a fresh chain (no cross-agent block)", async () => {
    const agentA = new MockRunLifecycleAgent();
    const agentB = new MockRunLifecycleAgent();
    const a1 = agentA.enqueueRun();
    const b1 = agentB.enqueueRun();
    const sinkA: CapturedHandlers = {};
    const sinkB: CapturedHandlers = {};

    // Two chats, one per agent — each CopilotChat keys its own queue by its
    // agent instance, so a different agent uses a fresh, independent chain.
    render(
      <CopilotKitProvider
        agents__unsafe_dev_only={{ default: agentA, other: agentB }}
      >
        <CopilotChatConfigurationProvider agentId="default" threadId="ta">
          <CopilotChat
            agentId="default"
            welcomeScreen={false}
            chatView={makeCaptureView(sinkA) as any}
          />
        </CopilotChatConfigurationProvider>
        <CopilotChatConfigurationProvider agentId="other" threadId="tb">
          <CopilotChat
            agentId="other"
            welcomeScreen={false}
            chatView={makeCaptureView(sinkB) as any}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    await actTick();
    expect(sinkA.onSubmitMessage).toBeDefined();
    expect(sinkB.onSubmitMessage).toBeDefined();

    // Send on agent A, start it, leave it uncompleted.
    await actTick(() => sinkA.onSubmitMessage!("for-A"));
    await actTick(() => a1.gateRunStarted.resolve());
    expect(agentA.runLog.length).toBe(1);

    // Send on agent B — its chain is independent of A's in-flight run, so B's
    // run starts despite A being unfinished.
    await actTick(() => sinkB.onSubmitMessage!("for-B"));
    await actTick(() => b1.gateRunStarted.resolve());
    expect(agentB.runLog.length).toBe(1);
    expect(agentB.runLog[0].messageContents).toContain("for-B");

    await actTick(() => {
      a1.gateCompletion.resolve();
      b1.gateCompletion.resolve();
    });
    expect(agentA.concurrentRuns).toBe(0);
    expect(agentB.concurrentRuns).toBe(0);
  });

  it("race4: a run that REJECTS before RUN_STARTED still releases the queue", async () => {
    const agent = new MockRunLifecycleAgent();
    const r1 = agent.enqueueRun({ failBeforeStart: true });
    const r2 = agent.enqueueRun();
    const sink: CapturedHandlers = {};
    renderChat({ default: agent }, "default", sink);
    await actTick();
    expect(sink.onSubmitMessage).toBeDefined();

    // Fire send #1 (which will fail) and IMMEDIATELY fire send #2 while #1 is
    // still in flight — without the queue both runAgent calls fire and overlap
    // (the rejection has not happened yet). With the queue, #2 is held until
    // #1's completion handle settles, even though #1 settles via REJECTION.
    await actTick(() => sink.onSubmitMessage!("will-fail"));
    await actTick(() => sink.onSubmitMessage!("after-fail"));

    // Only #1 should be in flight under the queue.
    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.length).toBe(1);

    // Release the failing run #1 — it rejects before RUN_STARTED. The queue
    // must NOT deadlock: the completion handle resolves on reject too, so #2
    // proceeds.
    await actTick(() => r1.gateRunStarted.resolve());
    expect(agent.runLog.length).toBe(2);
    await actTick(() => r2.gateRunStarted.resolve());
    await actTick(() => r2.gateCompletion.resolve());

    expect(agent.concurrentRuns).toBe(0);
    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog[1].messageContents).toContain("after-fail");
  });

  it("abort releases the queue: a settled run lets the next send proceed", async () => {
    const agent = new MockRunLifecycleAgent();
    const r1 = agent.enqueueRun();
    const r2 = agent.enqueueRun();
    const sink: CapturedHandlers = {};
    renderChat({ default: agent }, "default", sink);
    await actTick();
    expect(sink.onSubmitMessage).toBeDefined();

    // Send #1, start it, then fire send #2 WHILE #1 is still in flight.
    // Without the queue both runs overlap; with it, #2 is held.
    await actTick(() => sink.onSubmitMessage!("send-then-stop"));
    await actTick(() => r1.gateRunStarted.resolve());
    await actTick(() => sink.onSubmitMessage!("after-stop"));

    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.length).toBe(1);

    // Simulate the run ending due to an abort/stop (completion settles). This
    // must release the queued #2.
    await actTick(() => r1.gateCompletion.resolve());
    expect(agent.runLog.length).toBe(2);
    await actTick(() => r2.gateRunStarted.resolve());
    await actTick(() => r2.gateCompletion.resolve());

    expect(agent.concurrentRuns).toBe(0);
    expect(agent.maxConcurrentRuns).toBe(1);
  });

  it("race1 via suggestion selection: handleSelectSuggestion also serializes", async () => {
    const agent = new MockRunLifecycleAgent();
    const run1 = agent.enqueueRun();
    const run2 = agent.enqueueRun();
    const sink: CapturedHandlers = {};
    renderChat({ default: agent }, "default", sink);
    await actTick();
    expect(sink.onSelectSuggestion).toBeDefined();

    const sugg = (msg: string): Suggestion =>
      ({ title: msg, message: msg }) as Suggestion;

    await actTick(() => sink.onSelectSuggestion!(sugg("sugg-1"), 0));
    await actTick(() => run1.gateRunStarted.resolve());

    await actTick(() => sink.onSelectSuggestion!(sugg("sugg-2"), 0));
    await actTick(() => run2.gateRunStarted.resolve());

    expect(agent.maxConcurrentRuns).toBe(1);
    expect(agent.runLog.length).toBe(1);

    await actTick(() => run1.gateCompletion.resolve());
    expect(agent.runLog.length).toBe(2);
    await actTick(() => run2.gateCompletion.resolve());

    expect(agent.concurrentRuns).toBe(0);
    expect(agent.maxConcurrentRuns).toBe(1);
  });
});
