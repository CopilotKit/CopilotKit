import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import {
  MockStepwiseAgent,
  runStartedEvent,
  textChunkEvent,
} from "../../../__tests__/utils/test-helpers";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChat } from "../CopilotChat";

/**
 * Regression tests for the connect effect's cleanup registration.
 *
 * The connect effect used to early-return for non-explicit (locally-minted)
 * threadIds BEFORE registering its cleanup. With no cleanup, a run streaming
 * on a fresh thread was never detached when the user switched threads — the
 * old run's events kept applying to the shared per-agentId agent instance
 * and collided with the next thread's connect replay ("Cannot send
 * 'RUN_STARTED' while a run is still active").
 *
 * The cleanup must be registered unconditionally; only the connect() call
 * itself is gated on hasExplicitThreadId.
 */
describe("CopilotChat detaches in-flight runs on thread switch", () => {
  function buildTrackingAgent() {
    // Spies live in the closure, not on the instance: the provider may
    // clone() registered agents, and MockStepwiseAgent.clone() shares the
    // event subject but not instance fields.
    const detachedThreadIds: Array<string | undefined> = [];
    const runThreadIds: string[] = [];
    const connectSpy = vi.fn<(input: RunAgentInput) => void>();

    class TrackingAgent extends MockStepwiseAgent {
      run(input: RunAgentInput): Observable<BaseEvent> {
        runThreadIds.push(input.threadId);
        return super.run(input);
      }

      connect(input: RunAgentInput): Observable<BaseEvent> {
        connectSpy(input);
        return EMPTY;
      }

      // Records the threadId the agent pointed at when the detach arrived,
      // so tests can tell a cleanup-time detach (still on the outgoing
      // thread) from one issued after the agent was repointed.
      async detachActiveRun(): Promise<void> {
        detachedThreadIds.push(this.threadId);
      }
    }

    return {
      agent: new TrackingAgent(),
      detachedThreadIds,
      runThreadIds,
      connectSpy,
    };
  }

  async function startStreamingRun(
    agent: MockStepwiseAgent,
    runThreadIds: string[],
  ) {
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "stream for a while" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for the run pipeline to subscribe before emitting events.
    await waitFor(() => expect(runThreadIds).toHaveLength(1));
    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent("in-flight-msg", "still streaming"));
  }

  it("detaches the in-flight run before repointing the agent when switching to an explicit thread", async () => {
    const { agent, detachedThreadIds, runThreadIds, connectSpy } =
      buildTrackingAgent();

    const view = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} />
      </CopilotKitProvider>,
    );

    await startStreamingRun(agent, runThreadIds);
    const inFlightThreadId = runThreadIds[0];
    const detachCountBeforeSwitch = detachedThreadIds.length;

    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChat welcomeScreen={false} threadId="explicit-thread-b" />
      </CopilotKitProvider>,
    );

    await waitFor(() =>
      expect(detachedThreadIds.length).toBeGreaterThan(detachCountBeforeSwitch),
    );
    // The first detach after the switch must come from the effect cleanup,
    // which runs while the agent still points at the outgoing thread. A
    // detach issued only as a side effect of the new thread's connect would
    // arrive after agent.threadId was already mutated.
    expect(detachedThreadIds[detachCountBeforeSwitch]).toBe(inFlightThreadId);

    // The new explicit thread still connects afterwards.
    await waitFor(() => expect(connectSpy).toHaveBeenCalled());
    expect(connectSpy.mock.calls[0][0].threadId).toBe("explicit-thread-b");
  });

  it("detaches the in-flight run when switching between non-explicit threads, without connecting", async () => {
    const { agent, detachedThreadIds, runThreadIds, connectSpy } =
      buildTrackingAgent();

    const view = render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          threadId="local-thread-1"
          hasExplicitThreadId={false}
        >
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    await startStreamingRun(agent, runThreadIds);
    expect(runThreadIds[0]).toBe("local-thread-1");
    const detachCountBeforeSwitch = detachedThreadIds.length;

    view.rerender(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <CopilotChatConfigurationProvider
          threadId="local-thread-2"
          hasExplicitThreadId={false}
        >
          <CopilotChat welcomeScreen={false} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );

    // Non-explicit destinations never call connectAgent, so the effect
    // cleanup is the ONLY thing that can tear the old run down.
    await waitFor(() =>
      expect(detachedThreadIds.length).toBeGreaterThan(detachCountBeforeSwitch),
    );
    expect(detachedThreadIds[detachCountBeforeSwitch]).toBe("local-thread-1");
    // Non-explicit threads still skip /connect entirely.
    expect(connectSpy).not.toHaveBeenCalled();
  });
});
