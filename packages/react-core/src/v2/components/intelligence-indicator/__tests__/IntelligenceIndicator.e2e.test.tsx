import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const PILL_TESTID_RE = /^cpk-intelligence-pill-/;

const expectPillCount = (n: number): void => {
  expect(screen.queryAllByTestId(PILL_TESTID_RE).length).toBe(n);
};

const expectPillOn = (messageId: string): void => {
  expect(
    screen.getByTestId(`cpk-intelligence-pill-${messageId}`).textContent,
  ).toContain("Using CopilotKit Intelligence");
};

const expectNoPillOn = (messageId: string): void => {
  expect(screen.queryByTestId(`cpk-intelligence-pill-${messageId}`)).toBeNull();
};

const expectNoPillAnywhere = (): void => {
  expect(screen.queryAllByTestId(PILL_TESTID_RE).length).toBe(0);
};

const expectPillStatus = (
  messageId: string,
  status: "in-progress" | "finished",
): void => {
  expect(
    screen
      .getByTestId(`cpk-intelligence-pill-${messageId}`)
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

describe('IntelligenceIndicator — "Using CopilotKit Intelligence" (auto-mounted)', () => {
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
   * Walks through the canonical scenario:
   *
   *   RUN A
   *     m_a1 (assistant) → toolCall bash#1, bash#2
   *   RUN B
   *     m_b1 (assistant) → toolCall bash
   *     m_b2 (assistant) → toolCall bash#1, bash#2
   *
   * The pill must render only on the last message of the latest
   * in-flight run — never on multiple messages, never on stale runs,
   * never on a non-last message of the current run.
   */
  it("renders only on the last message of the latest in-flight run", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    expectNoPillAnywhere();

    // ─── Run A: m_a1 with two tool calls → pill on m_a1 ───────────────
    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_a1", [
      { id: "tc_a1_1", arg: '{"cmd":"ls"}' },
      { id: "tc_a1_2", arg: '{"cmd":"pwd"}' },
    ]);
    await waitFor(() => expectPillOn("m_a1"));
    expectPillCount(1);

    agent.emit(runFinishedEvent());

    // ─── Run B: m_b1 (one bash) ──────────────────────────────────────
    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_b1", [
      { id: "tc_b1", arg: '{"cmd":"echo b1"}' },
    ]);
    await waitFor(() => expectPillOn("m_b1"));
    // m_b1 supersedes m_a1 as the latest matching-assistant slot, so
    // m_a1's pill is gated out — even though it had settled into its
    // persistent finished state.
    await waitFor(() => expectNoPillOn("m_a1"));
    expectPillCount(1);

    // ─── m_b2 streams in — pill moves to m_b2, m_b1 loses pill ────────
    emitAssistantMessageWithToolCalls(agent, "m_b2", [
      { id: "tc_b2_1", arg: '{"cmd":"echo b2-1"}' },
      { id: "tc_b2_2", arg: '{"cmd":"echo b2-2"}' },
    ]);
    await waitFor(() => expectPillOn("m_b2"));
    expectNoPillOn("m_b1");
    expectNoPillOn("m_a1");
    expectPillCount(1);

    // ─── Run B finishes — the pill persists on m_b2 in its finished
    //      resting state rather than unmounting ─────────────────────────
    agent.emit(runFinishedEvent());
    await waitFor(() => expectPillStatus("m_b2", "finished"));
    expectPillOn("m_b2");
    expectPillCount(1);
  });

  // ─── Per-condition focused tests ────────────────────────────────────

  it("condition (last-in-run): never renders on a non-last message of the run", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_first", [
      { id: "tc_first", arg: "{}" },
    ]);
    // Wait for m_first to render the pill while it is still the last
    // message in the run. Without this gate, both messages would land
    // synchronously and m_first's renderer would never have been
    // invoked while it was the last — turning a reactive assertion
    // into a first-render correctness test by accident.
    await waitFor(() => expectPillOn("m_first"));

    emitAssistantMessageWithToolCalls(agent, "m_second", [
      { id: "tc_second", arg: "{}" },
    ]);

    await waitFor(() => expectPillOn("m_second"));
    expectNoPillOn("m_first");
    expectPillCount(1);
  });

  it("condition (in-flight): pill settles into a persistent finished state after the run finishes", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_only", [
      { id: "tc", arg: "{}" },
    ]);
    await waitFor(() => expectPillStatus("m_only", "in-progress"));

    agent.emit(runFinishedEvent());
    await waitFor(() => expectPillStatus("m_only", "finished"));
    expectPillOn("m_only");
    expectPillCount(1);
  });

  it("condition (latest-run): never renders on a stale run after a newer run starts", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_run1", [
      { id: "tc_run1", arg: "{}" },
    ]);
    await waitFor(() => expectPillOn("m_run1"));
    agent.emit(runFinishedEvent());

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_run2", [
      { id: "tc_run2", arg: "{}" },
    ]);
    await waitFor(() => expectPillOn("m_run2"));
    expectNoPillOn("m_run1");
  });

  it("condition (tool-match): only renders when a configured tool name matches", async () => {
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    // First message has only a non-matching tool call; no pill.
    emitAssistantMessageWithToolCalls(agent, "m_no_match", [
      { id: "tc_no_match", name: "fetch", arg: "{}" },
    ]);
    await new Promise((r) => setTimeout(r, 80));
    expectNoPillOn("m_no_match");

    // Second message has a bash call — pill should appear on it.
    emitAssistantMessageWithToolCalls(agent, "m_match", [
      { id: "tc_match", name: "copilotkit_knowledge_base_shell", arg: "{}" },
    ]);
    await waitFor(() => expectPillOn("m_match"));
    expectPillCount(1);
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
    await waitFor(() => expectPillOn("m_match"));
    expectPillCount(1);
  });

  it("intelligence gate: does not render when copilotkit.intelligence is undefined", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, { withIntelligence: false });
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m1", [{ id: "tc1", arg: "{}" }]);

    // Without the gate, the pill would be visible by now.
    await new Promise((r) => setTimeout(r, 80));
    expectNoPillAnywhere();
  });

  it("auto-registration: no renderCustomMessages prop is required", async () => {
    // This is the explicit assertion that the indicator auto-mounts.
    // `renderForIndicator` does not pass `renderCustomMessages`, yet
    // the pill renders solely because intelligence is configured.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m1", [{ id: "tc1", arg: "{}" }]);

    await waitFor(() => expectPillOn("m1"));
    expectPillCount(1);
  });

  // ─── New gate: tool-call pending past grace window ──────────────────

  it("replay-flash suppression: no pill when tool result arrives within the grace window", async () => {
    // Models a `connectAgent` history replay: the tool call and its
    // matching `tool`-role result arrive in the same tick, well below
    // PENDING_THRESHOLD_MS. The pill timer should be cancelled before
    // it fires, so nothing renders.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_replay", [
      { id: "tc_replay", arg: '{"cmd":"ls"}' },
    ]);
    emitToolResult(agent, "tc_replay", "tr_replay");

    // Wait past the grace window — pill should never appear.
    await new Promise((r) => setTimeout(r, 200));
    expectNoPillAnywhere();
  });

  it("multi-step: pill stays continuously across tool-result interleaving", async () => {
    // Tool result arrives, then a second assistant message with bash.
    // The pill must not show the completed/fade animation between
    // calls — it stays on m_step1 until m_step2 takes over the slot.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_step1", [
      { id: "tc_step1", arg: '{"cmd":"ls"}' },
    ]);
    await waitFor(() => expectPillOn("m_step1"));

    // Tool result lands. agent.isRunning is still true, no real
    // follow-up yet → pill stays on m_step1 in spinner.
    emitToolResult(agent, "tc_step1", "tr_step1");
    await new Promise((r) => setTimeout(r, 150));
    expectPillOn("m_step1");
    expectPillCount(1);

    // Second assistant message with bash arrives. Slot moves; old
    // instance returns null without a fade animation.
    emitAssistantMessageWithToolCalls(agent, "m_step2", [
      { id: "tc_step2", arg: '{"cmd":"pwd"}' },
    ]);
    await waitFor(() => expectPillOn("m_step2"));
    expectNoPillOn("m_step1");
    expectPillCount(1);
  });

  it("real-followup exit: prose assistant message after the tool flow settles the pill into finished", async () => {
    // After the tool result the agent emits a final prose message —
    // that's a "real follow-up" and should immediately exit the spinner
    // (without waiting on isRunning), settling into the finished state.
    // The prose message is not a matching-assistant message, so m_tool
    // remains the latest matching slot and keeps the persistent pill.
    const agent = makeAgent();
    renderForIndicator(agent);
    await screen.findByTestId("trigger-run");

    await triggerRun(agent);
    startRun(agent);
    emitAssistantMessageWithToolCalls(agent, "m_tool", [
      { id: "tc_only", arg: '{"cmd":"ls"}' },
    ]);
    await waitFor(() => expectPillStatus("m_tool", "in-progress"));

    emitToolResult(agent, "tc_only", "tr_only");
    emitAssistantProse(agent, "m_prose", "All done.");

    await waitFor(() => expectPillStatus("m_tool", "finished"));
    expectPillCount(1);
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
    // The default pill is replaced entirely by the custom face.
    expectPillCount(0);
  });

  it("slot override (string): a className is merged onto the default pill", async () => {
    const agent = makeAgent();
    renderForIndicator(agent, { intelligenceIndicator: "my-custom-pill" });
    await screen.findByTestId("trigger-run");

    await startMatchingRun(agent, "m1");
    await waitFor(() => expectPillOn("m1"));
    expect(screen.getByTestId("cpk-intelligence-pill-m1").className).toContain(
      "my-custom-pill",
    );
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
        screen.getByTestId("cpk-intelligence-pill-m1").textContent,
      ).toContain("Recalling memory"),
    );
  });
});
