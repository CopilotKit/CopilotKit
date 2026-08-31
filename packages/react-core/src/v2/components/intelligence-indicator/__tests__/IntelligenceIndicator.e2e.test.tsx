import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import type { Subject } from "rxjs";
import { takeWhile } from "rxjs/operators";
import {
  MockStepwiseAgent,
  runStartedEvent,
  runFinishedEvent,
  textMessageStartEvent,
  textMessageContentEvent,
  textMessageEndEvent,
  toolCallChunkEvent,
  toolCallResultEvent,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../../chat/CopilotChat";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { useCopilotKit } from "../../../providers/CopilotKitProvider";
import { useAgent } from "../../../hooks/use-agent";
import type { SlotValue } from "../../../lib/slots";
import type {
  IntelligenceIndicatorView,
  IntelligenceIndicatorViewProps,
} from "../IntelligenceIndicatorView";

type IndicatorSlot = SlotValue<typeof IntelligenceIndicatorView>;

/**
 * Mock agent with accurate per-run `isRunning` lifecycle. The shared
 * `MockStepwiseAgent` returns the un-terminating `subject.asObservable()`
 * for backward compatibility, so emitting `RUN_FINISHED` on it doesn't
 * complete the rxjs pipeline → `isRunning` never flips back. The
 * `takeWhile(..., true)` here makes the per-run observable terminate on
 * RUN_FINISHED / RUN_ERROR (the `true` is "inclusive" — emit the
 * terminal event before completing). That terminates AG-UI's run
 * pipeline like a real agent so the indicator sees the falling edge.
 */
class IsRunningAccurateMockAgent extends MockStepwiseAgent {
  override run(_input: RunAgentInput): Observable<BaseEvent> {
    return (this as unknown as { subject: Subject<BaseEvent> }).subject.pipe(
      takeWhile(
        (event) =>
          event.type !== EventType.RUN_FINISHED &&
          event.type !== EventType.RUN_ERROR,
        true,
      ),
    );
  }
}

const INDICATOR_TESTID_RE = /^cpk-intelligence-indicator-/;

const expectIndicatorCount = (n: number): void => {
  expect(screen.queryAllByTestId(INDICATOR_TESTID_RE).length).toBe(n);
};

const expectIndicatorOn = (messageId: string): void => {
  expect(
    screen.getByTestId(`cpk-intelligence-indicator-${messageId}`).textContent,
  ).toContain("CopilotKit Intelligence");
};

const expectNoIndicatorAnywhere = (): void => {
  expect(screen.queryAllByTestId(INDICATOR_TESTID_RE).length).toBe(0);
};

const expectIndicatorStatus = (
  messageId: string,
  status: "in-progress" | "finished",
): void => {
  expect(
    screen
      .getByTestId(`cpk-intelligence-indicator-${messageId}`)
      .getAttribute("data-status"),
  ).toBe(status);
};

const emitAssistantMessageWithToolCalls = (
  agent: MockStepwiseAgent,
  messageId: string,
  toolCalls: Array<{ id: string; name?: string; arg: string }>,
): void => {
  agent.emit(textMessageStartEvent(messageId));
  agent.emit(textMessageEndEvent(messageId));
  for (const tc of toolCalls) {
    agent.emit(
      toolCallChunkEvent({
        toolCallId: tc.id,
        toolCallName: tc.name ?? "copilotkit_knowledge_base_shell",
        parentMessageId: messageId,
        delta: tc.arg,
      }),
    );
  }
};

const emitToolResult = (
  agent: MockStepwiseAgent,
  toolCallId: string,
  resultMessageId: string,
  content = "ok",
): void => {
  agent.emit(
    toolCallResultEvent({ toolCallId, messageId: resultMessageId, content }),
  );
};

const emitAssistantProse = (
  agent: MockStepwiseAgent,
  messageId: string,
  text: string,
): void => {
  agent.emit(textMessageStartEvent(messageId));
  agent.emit(textMessageContentEvent(messageId, text));
  agent.emit(textMessageEndEvent(messageId));
};

/**
 * Add a user message to `agent.messages`. User messages are turn
 * boundaries — the indicator's per-turn gating treats every assistant
 * message between two user messages as part of the same turn. We push
 * directly via `addMessages` because text-message events emitted
 * outside an active run don't flow through the AG-UI pipeline.
 */
const emitUserMessage = (
  agent: MockStepwiseAgent,
  messageId: string,
  text: string,
): void => {
  act(() => {
    agent.addMessages([
      {
        id: messageId,
        role: "user",
        content: text,
      },
    ]);
  });
};

const startRun = (agent: MockStepwiseAgent): void => {
  agent.emit(runStartedEvent());
};

/**
 * Test harness: drives `copilotkit.runAgent` from a click and force-sets
 * `copilotkit.intelligence` on the live core. Apps observe the
 * intelligence-set-up state via a real `/info` round trip; tests bypass
 * that plumbing by writing directly into the registry's private slot.
 */
const RunAgentHarness: React.FC<{ withIntelligence: boolean }> = ({
  withIntelligence,
}) => {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent();

  React.useEffect(() => {
    const reg = (
      copilotkit as unknown as {
        agentRegistry: { _intelligence?: { wsUrl: string } };
      }
    ).agentRegistry;
    if (withIntelligence) {
      reg._intelligence = { wsUrl: "wss://test/intelligence" };
    } else {
      reg._intelligence = undefined;
    }
  }, [copilotkit, withIntelligence]);

  const handleClick = React.useCallback(() => {
    if (!agent) return;
    copilotkit.runAgent({ agent }).catch((err: unknown) => {
      console.error("[test] copilotkit.runAgent rejected:", err);
      throw err;
    });
  }, [copilotkit, agent]);

  return (
    <button data-testid="trigger-run" onClick={handleClick}>
      run
    </button>
  );
};

interface RenderOptions {
  withIntelligence?: boolean;
  intelligenceIndicator?: IndicatorSlot;
}

const renderForIndicator = (
  agent: MockStepwiseAgent,
  options: RenderOptions = {},
): void => {
  const { withIntelligence = true, intelligenceIndicator } = options;

  // No `renderCustomMessages` prop is passed — the indicator
  // auto-mounts when intelligence is configured.
  render(
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <CopilotChatConfigurationProvider agentId="default" threadId="t">
        <RunAgentHarness withIntelligence={withIntelligence} />
        <div style={{ height: 400 }}>
          <CopilotChat
            welcomeScreen={false}
            intelligenceIndicator={intelligenceIndicator}
          />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
};

const triggerRun = async (agent: MockStepwiseAgent): Promise<void> => {
  await waitFor(() => expect(agent.isRunning).toBe(false));
  fireEvent.click(screen.getByTestId("trigger-run"));
  await waitFor(() => expect(agent.isRunning).toBe(true));
};

/** Start a run that emits one assistant message with a single matching tool call. */
const startMatchingRun = async (
  agent: MockStepwiseAgent,
  messageId: string,
  toolCallId = "tc1",
): Promise<void> => {
  await triggerRun(agent);
  startRun(agent);
  emitAssistantMessageWithToolCalls(agent, messageId, [
    { id: toolCallId, arg: "{}" },
  ]);
};

/** A full-component slot override that surfaces the state it receives. */
const CustomIndicator = ({
  status,
  label,
}: IntelligenceIndicatorViewProps): React.ReactElement => (
  <div data-testid="custom-indicator" data-custom-status={status}>
    {label}
  </div>
);

const expectCustomStatus = (status: "in-progress" | "finished"): void => {
  expect(
    screen.getByTestId("custom-indicator").getAttribute("data-custom-status"),
  ).toBe(status);
};

describe('IntelligenceIndicator — "CopilotKit Intelligence" (auto-mounted)', () => {
  const activeAgents: IsRunningAccurateMockAgent[] = [];
  const makeAgent = (): IsRunningAccurateMockAgent => {
    const agent = new IsRunningAccurateMockAgent();
    activeAgents.push(agent);
    return agent;
  };
  afterEach(() => {
    while (activeAgents.length) {
      const agent = activeAgents.pop()!;
      try {
        agent.complete();
      } catch (err) {
        console.error("[test] agent.complete() threw during cleanup:", err);
      }
    }
  });

  /**
   * Within a single turn (no user message between assistant messages),
   * the indicator anchors to the FIRST bash-using assistant message and
   * STAYS there — later bash-using messages in the same turn do not move
   * it. Keeping the anchor fixed means the spinner never abruptly jumps
   * position mid-turn. After the turn finishes it settles into its
   * persistent finished state on that same first message.
   */
  it("within a single turn: anchors to the first bash-using assistant and stays put; settles to finished", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    expectNoIndicatorAnywhere();

    await triggerRun(agent);
    startRun(agent);

    emitAssistantMessageWithToolCalls(agent, "m_a1", [
      { id: "tc_a1_1", arg: '{"cmd":"ls"}' },
      { id: "tc_a1_2", arg: '{"cmd":"pwd"}' },
    ]);
    await waitFor(() => expectIndicatorOn("m_a1"));
    expectIndicatorCount(1);

    // Turn finishes → indicator settles on m_a1 (the first) in finished state.
    agent.emit(runFinishedEvent());
    await waitFor(() => expectIndicatorStatus("m_a1", "finished"));
    expectIndicatorOn("m_a1");
    expectIndicatorCount(1);
  });

  /**
   * Headline per-turn persistence test. A user message between two
   * Intelligence-using runs marks a turn boundary. Each turn's
   * indicator anchors on its own first bash-using assistant message, and
   * the prior turn's indicator stays in chat history when a new turn
   * starts — they coexist in the DOM.
   */
  it("per-turn persistence: indicators from past turns remain when a new turn starts", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    // ─── Turn 1 ──────────────────────────────────────────────────────
    emitUserMessage(agent, "u1", "tell me about portland");
    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_t1", [
      { id: "tc_t1", arg: '{"cmd":"grep portland"}' },
    ]);
    await waitFor(() => expectIndicatorStatus("m_t1", "in-progress"));
    agent.emit(runFinishedEvent());
    await waitFor(() => expectIndicatorStatus("m_t1", "finished"));
    expectIndicatorCount(1);

    // ─── Turn 2 (user message marks the new turn) ───────────────────
    emitUserMessage(agent, "u2", "what about seattle");
    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_t2", [
      { id: "tc_t2", arg: '{"cmd":"grep seattle"}' },
    ]);

    // Turn 2's indicator appears, and Turn 1's stays in the DOM.
    await waitFor(() => expectIndicatorStatus("m_t2", "in-progress"));
    expectIndicatorStatus("m_t1", "finished");
    expectIndicatorCount(2);

    agent.emit(runFinishedEvent());
    await waitFor(() => expectIndicatorStatus("m_t2", "finished"));
    expectIndicatorStatus("m_t1", "finished");
    expectIndicatorCount(2);
  });

  // NOTE: "anchors to the FIRST bash-using message of a turn, never a later
  // one" is proven deterministically in `intelligence-indicator-logic.test.ts`
  // (getIntelligenceTurnAnchors), so it's not re-driven through the live timer
  // here.

  it("condition (in-flight): indicator settles into a persistent finished state after the run finishes", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_only", [
      { id: "tc", arg: "{}" },
    ]);
    await waitFor(() => expectIndicatorStatus("m_only", "in-progress"));

    agent.emit(runFinishedEvent());
    await waitFor(() => expectIndicatorStatus("m_only", "finished"));
    expectIndicatorOn("m_only");
    expectIndicatorCount(1);
  });

  it("condition (tool-match): only renders when a configured tool name matches", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    // A bash call lights the pill. (That a *non*-matching tool name yields no
    // anchor is proven in the getIntelligenceTurnAnchors logic test.)
    emitAssistantMessageWithToolCalls(agent, "m_match", [
      { id: "tc_match", name: "copilotkit_knowledge_base_shell", arg: "{}" },
    ]);
    await waitFor(() => expectIndicatorOn("m_match"));
    expectIndicatorCount(1);
  });

  it("condition (tool-match): renders for the namespaced mcp__ tool name", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    // `@ag-ui/mcp-middleware` namespaces MCP tools as
    // `mcp__<server>__<tool>`; the contains-match must still light the pill.
    emitAssistantMessageWithToolCalls(agent, "m_match", [
      {
        id: "tc_match",
        name: "mcp__intelligence__copilotkit_knowledge_base_shell",
        arg: "{}",
      },
    ]);
    await waitFor(() => expectIndicatorOn("m_match"));
    expectIndicatorCount(1);
  });

  it("intelligence gate: does not render when copilotkit.intelligence is undefined", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, { withIntelligence: false });
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m1", [{ id: "tc1", arg: "{}" }]);

    // The intelligence gate (`copilotkit.intelligence === undefined → null`) is
    // a synchronous render gate, independent of the grace timer — the indicator
    // is never produced. Wait for the message to reconcile, then assert absence.
    await waitFor(() => expect(agent.messages.length).toBeGreaterThan(0));
    expectNoIndicatorAnywhere();
  });

  it("auto-registration: no renderCustomMessages prop is required", async () => {
    // Explicit assertion that the indicator auto-mounts.
    // `renderForIndicator` does not pass `renderCustomMessages`, yet
    // the indicator renders solely because intelligence is configured.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m1", [{ id: "tc1", arg: "{}" }]);

    await waitFor(() => expectIndicatorOn("m1"));
    expectIndicatorCount(1);
  });

  // NOTE: replay-flash suppression (a tool call + result that resolve before
  // the grace window elapses must not flash a spinner) is the pure decision
  // `resolveGracePhase(turnComplete=false, hasPending=false) === "hidden"`,
  // covered in `intelligence-indicator-logic.test.ts` without any timer.

  /**
   * When the brain mounts onto a message whose turn is already complete
   * (e.g. `/connect` history replay finished before the component
   * mounted), the indicator should render directly in finished state
   * without flashing through spinner first.
   */
  it("historical replay: completed turn renders directly in finished state", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    // Emit the assistant message + tool call + tool result + a prose
    // follow-up before any "live" tracking can attach. By the time the
    // assertions run, `hasPending` is false and `sawRealFollowup` is
    // true — the brain has no live work to track.
    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_hist", [
      { id: "tc_hist", arg: "{}" },
    ]);
    emitToolResult(agent, "tc_hist", "tr_hist");
    emitAssistantProse(agent, "m_prose", "Done.");
    agent.emit(runFinishedEvent());

    // The indicator should be in finished state immediately, without
    // ever flashing through spinner.
    await waitFor(() => expectIndicatorStatus("m_hist", "finished"));
    expectIndicatorCount(1);
  });

  // NOTE: "the anchor stays fixed on the first bash message across tool-result
  // interleaving and a later bash message" is the anchoring invariant proven in
  // `intelligence-indicator-logic.test.ts`; continuity-without-remount across an
  // anchor change is covered by the "bug 1 (no remount)" test below.

  it("real-followup exit: prose assistant after the tool flow settles the indicator into finished", async () => {
    // After the tool result the agent emits a final prose message —
    // that's a "real follow-up" and should immediately exit the
    // spinner, settling into finished state. The prose message is not
    // a matching-assistant message, so m_tool remains the turn's anchor
    // and keeps the persistent indicator.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_tool", [
      { id: "tc_only", arg: '{"cmd":"ls"}' },
    ]);
    await waitFor(() => expectIndicatorStatus("m_tool", "in-progress"));

    emitToolResult(agent, "tc_only", "tr_only");
    emitAssistantProse(agent, "m_prose", "All done.");

    await waitFor(() => expectIndicatorStatus("m_tool", "finished"));
    expectIndicatorCount(1);
  });

  it("bug 1 (no remount): the face is not torn down across an anchor hand-off within a turn", async () => {
    // Within one turn a second bash-using assistant message arrives. The
    // indicator is keyed by turn (not by message) and anchored to the FIRST
    // bash message, so the SAME face instance stays mounted — no unmount, no
    // remount, no spinner restart. A remount here is exactly bug 1's flicker.
    // (Under the old per-message keying a later bash counted as a new mount.)
    let mountCount = 0;
    let unmountCount = 0;
    const Tracking = ({
      status,
      label,
    }: IntelligenceIndicatorViewProps): React.ReactElement => {
      React.useEffect(() => {
        mountCount += 1;
        return () => {
          unmountCount += 1;
        };
      }, []);
      return (
        <div data-testid="tracking-indicator" data-custom-status={status}>
          {label}
        </div>
      );
    };

    const agent = makeAgent();
    renderForIndicator(agent, { intelligenceIndicator: Tracking });
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);

    emitAssistantMessageWithToolCalls(agent, "m_a1", [
      { id: "tc_a1", arg: '{"cmd":"ls"}' },
    ]);
    // Face mounts exactly once, after the grace window.
    await waitFor(() => expect(mountCount).toBe(1));

    // A later bash-using assistant arrives in the SAME turn.
    emitAssistantMessageWithToolCalls(agent, "m_a2", [
      { id: "tc_a2", arg: '{"cmd":"pwd"}' },
    ]);
    // Wait for m_a2 to reconcile (deterministic, event-driven) — any incorrect
    // remount would have surfaced by the time it is in the message tree.
    await waitFor(() =>
      expect(agent.messages.some((m) => m.id === "m_a2")).toBe(true),
    );

    // The instance was never torn down (keyed by turn, not by message).
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(screen.getAllByTestId("tracking-indicator")).toHaveLength(1);
  });

  // ─── Slot customization (the three SlotValue tiers) ──────────────────

  it("slot override (component): a custom face receives status and persists when finished", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, { intelligenceIndicator: CustomIndicator });
    await screen.findByTestId("trigger-run");

    await startMatchingRun(agent, "m1");
    await waitFor(() => expectCustomStatus("in-progress"));

    agent.emit(runFinishedEvent());
    await waitFor(() => expectCustomStatus("finished"));
    // The default indicator is replaced entirely by the custom face.
    expectIndicatorCount(0);
  });

  it("slot override (string): a className is merged onto the default indicator", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, { intelligenceIndicator: "my-custom-cls" });
    await screen.findByTestId("trigger-run");

    await startMatchingRun(agent, "m1");
    await waitFor(() => expectIndicatorOn("m1"));
    expect(
      screen.getByTestId("cpk-intelligence-indicator-m1").className,
    ).toContain("my-custom-cls");
  });

  it("slot override (props): a props object overrides the label", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, {
      intelligenceIndicator: { label: "Recalling memory" },
    });
    await screen.findByTestId("trigger-run");

    await startMatchingRun(agent, "m1");
    await waitFor(() =>
      expect(
        screen.getByTestId("cpk-intelligence-indicator-m1").textContent,
      ).toContain("Recalling memory"),
    );
  });
});
