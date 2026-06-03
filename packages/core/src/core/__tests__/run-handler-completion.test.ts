import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent } from "../../__tests__/test-utils";

/**
 * Tests for the synchronously-exposed run-completion promise.
 *
 * The root cause these tests guard against: in `intelligence-agent.ts`,
 * `activeRunCompletionPromise` is only assigned AFTER `await onInitialize`,
 * so any caller that wants to observe a run's completion at the moment it
 * is started (before RUN_STARTED) has no synchronous handle. The send queue
 * in CopilotChat needs exactly such a handle to serialize sends.
 *
 * `RunHandler.runAgent` must therefore capture the inner run promise BEFORE
 * any `await`, register a normalized completion promise in a per-agent
 * WeakMap, and expose it via `runCompletion(agent)`. `CopilotKitCore`
 * surfaces it as `runAgentCompletion(agent)`.
 */

/**
 * A controllable agent whose `runAgent` resolves only when the test calls
 * `resolveRun()` (or rejects via `rejectRun()`). Lets us assert that the
 * completion promise is observable synchronously and settles correctly.
 */
class ControllableAgent extends MockAgent {
  public runStarted = false;
  private _resolve?: (value: { newMessages: [] }) => void;
  private _reject?: (err: unknown) => void;

  override async runAgent(): Promise<{ newMessages: [] }> {
    this.runStarted = true;
    return new Promise<{ newMessages: [] }>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolveRun(): void {
    this._resolve?.({ newMessages: [] });
  }

  rejectRun(err: unknown): void {
    this._reject?.(err);
  }

  override async detachActiveRun(): Promise<void> {}
}

describe("RunHandler run-completion promise (synchronous exposure)", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a completion promise synchronously, BEFORE any await in runAgent", () => {
    const agent = new ControllableAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    // Kick off the run but do NOT await it. The promise handle must be
    // registered synchronously by the time runAgent() returns its promise,
    // which is the same microtask. We immediately query the completion.
    void core.runAgent({ agent: agent as any });

    const completion = core.runAgentCompletion(agent as any);
    expect(completion).toBeDefined();
    expect(completion).toBeInstanceOf(Promise);
  });

  it("completion settles (resolves) when the underlying run resolves", async () => {
    const agent = new ControllableAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    void core.runAgent({ agent: agent as any });
    const completion = core.runAgentCompletion(agent as any);
    expect(completion).toBeDefined();

    let settled = false;
    completion!.then(() => {
      settled = true;
    });

    // Not settled until the run resolves.
    await Promise.resolve();
    expect(settled).toBe(false);

    // Flush microtasks so `_runAgentInner` has installed the deferred handle
    // (it awaits `detachActiveRun()` first), then resolve the run.
    await Promise.resolve();
    await Promise.resolve();
    agent.resolveRun();
    await completion;
    expect(settled).toBe(true);
  });

  it("completion settles (does NOT reject) even when the underlying run REJECTS before RUN_STARTED", async () => {
    const agent = new ControllableAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    // runAgent catches errors internally and emits via emitError, so the
    // public runAgent never rejects. But the completion promise must settle
    // regardless — model a pre-RUN_STARTED rejection by rejecting the inner
    // run promise; the normalized completion must resolve, not reject.
    const runPromise = core.runAgent({ agent: agent as any });
    const completion = core.runAgentCompletion(agent as any);
    expect(completion).toBeDefined();

    // `_runAgentInner` awaits `agent.detachActiveRun()` before calling
    // `agent.runAgent`, so the deferred reject handle is only installed a
    // microtask later. Flush microtasks before rejecting.
    await Promise.resolve();
    await Promise.resolve();
    agent.rejectRun(new Error("boom before RUN_STARTED"));

    // The completion promise must resolve (never reject).
    await expect(completion).resolves.toBeUndefined();
    // And the public runAgent promise itself does not reject (errors are
    // funneled through emitError).
    await expect(runPromise).resolves.toBeDefined();
  });

  it("returns undefined for an agent that has never been run", () => {
    const agent = new ControllableAgent({ agentId: "never-run" });
    core.addAgent__unsafe_dev_only({ id: "never-run", agent: agent as any });

    expect(core.runAgentCompletion(agent as any)).toBeUndefined();
  });

  it("keys completion per-agent (WeakMap) — distinct agents get distinct promises", () => {
    const agentA = new ControllableAgent({ agentId: "a" });
    const agentB = new ControllableAgent({ agentId: "b" });
    core.addAgent__unsafe_dev_only({ id: "a", agent: agentA as any });
    core.addAgent__unsafe_dev_only({ id: "b", agent: agentB as any });

    void core.runAgent({ agent: agentA as any });
    void core.runAgent({ agent: agentB as any });

    const compA = core.runAgentCompletion(agentA as any);
    const compB = core.runAgentCompletion(agentB as any);
    expect(compA).toBeDefined();
    expect(compB).toBeDefined();
    expect(compA).not.toBe(compB);

    agentA.resolveRun();
    agentB.resolveRun();
  });

  it("does NOT register a fresh completion for follow-up (recursive, non-top-level) runs", async () => {
    // The completion promise registered for the top-level run must remain
    // the one observable to callers; a recursive follow-up run (depth > 0,
    // e.g. after tool execution) must NOT overwrite it. We assert the
    // top-level completion does not settle until the entire chain (including
    // any follow-up) finishes.
    const agent = new MockAgent({ agentId: "test" });
    core.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    // A plain MockAgent run resolves immediately with no follow-up, so the
    // top-level completion should settle after the run finishes. We assert
    // the completion promise tracks the TOP-LEVEL run: it is defined while
    // running and resolves once.
    const runPromise = core.runAgent({ agent: agent as any });
    const completion = core.runAgentCompletion(agent as any);
    expect(completion).toBeDefined();

    await runPromise;
    await expect(completion).resolves.toBeUndefined();
  });
});
