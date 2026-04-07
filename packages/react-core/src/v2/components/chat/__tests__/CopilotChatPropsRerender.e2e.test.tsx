/**
 * Regression tests for FOR-75: messageView / labels props freeze
 *
 * These tests prove that passing `messageView` or `labels` as inline props
 * to CopilotChat does NOT cause completed assistant messages to re-render on
 * every keystroke.
 *
 * Tests FAIL on unfixed code (reproducing the bug).
 * Tests PASS after the fix is applied.
 *
 * Render counts are deterministic regardless of hardware — the bug is about
 * reference instability, not wall-clock timing.
 */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { useCopilotChatConfiguration } from "../../../providers/CopilotChatConfigurationProvider";

// ---------------------------------------------------------------------------
// Shared mock agent (same pattern as CopilotChatToolRerenders.e2e.test.tsx)
// ---------------------------------------------------------------------------
class MockStepwiseAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    act(() => {
      this.subject.next(event);
    });
  }

  complete() {
    this.isRunning = false;
    this.subject.complete();
  }

  clone(): MockStepwiseAgent {
    const cloned = new MockStepwiseAgent();
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }

  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

// ---------------------------------------------------------------------------
// Helper: submit a user message (triggers agent.run()), then emit a complete
// assistant response and wait for the counting component to appear in the DOM.
//
// Uses data-testid rather than text content to avoid false positives from
// components that render fixed strings regardless of the message payload.
// ---------------------------------------------------------------------------
async function submitAndReceiveAssistantMessage(
  agent: MockStepwiseAgent,
  messageId: string,
) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText("hello")).toBeDefined();
  });

  agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
  agent.emit({
    type: EventType.TEXT_MESSAGE_CHUNK,
    messageId,
    delta: "assistant reply",
  } as BaseEvent);
  agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);

  await waitFor(() => {
    expect(screen.getByTestId("counting-assistant")).toBeDefined();
  });

  await act(async () => {
    agent.complete();
  });
}

// ---------------------------------------------------------------------------
// Test 1 — messageView inline object
//
// Counting component defined OUTSIDE the test so its function reference is
// stable. The outer messageView object is inline (new ref on every render),
// which is what triggers the bug.
// ---------------------------------------------------------------------------
let assistantRenderCount = 0;
function CountingAssistantMessage(
  _props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
) {
  assistantRenderCount++;
  return <div data-testid="counting-assistant" />;
}

// ---------------------------------------------------------------------------
// Test 2 — labels inline object
//
// Reads directly from useCopilotChatConfiguration() so that context churn
// (caused by the labels fix being absent) is observable independently of
// whether the messageView slot is re-rendered. Context consumers re-render
// when their context value changes regardless of parent memoization, so this
// is a genuine guard for the labels stabilization fix.
// ---------------------------------------------------------------------------
let labelConsumerRenderCount = 0;
function LabelConsumerMessage(
  _props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
) {
  useCopilotChatConfiguration(); // subscribe to CopilotChatConfiguration context
  labelConsumerRenderCount++;
  return <div data-testid="counting-assistant" />;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FOR-75: messageView / labels props — no re-renders on input change", () => {
  beforeEach(() => {
    assistantRenderCount = 0;
    labelConsumerRenderCount = 0;
  });

  /**
   * Test 1: messageView inline object
   *
   * When `messageView` is passed as an inline object prop (e.g.
   * `messageView={{ assistantMessage: Cmp }}`), a new object reference is
   * created on every parent render. Without the fix, ts-deepmerge clones the
   * value, producing a new reference that defeats MemoizedSlotWrapper's
   * shallow equality check → the whole message list re-renders on every
   * keystroke.
   *
   * Fix: useShallowStableRef in CopilotChat.tsx keeps the same object
   * reference as long as the slot props are shallowly equal.
   */
  it("messageView inline object: completed messages do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <div style={{ height: 400 }}>
          <CopilotChat
            messageView={{
              assistantMessage:
                CountingAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
            }}
          />
        </div>
      </CopilotKitProvider>,
    );

    await submitAndReceiveAssistantMessage(agent, "msg-1");

    const renderCountAfterMessage = assistantRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    // Type into the input — only inputValue state changes; messages unchanged.
    // Completed messages must NOT re-render.
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    await act(async () => {});

    expect(assistantRenderCount).toBe(renderCountAfterMessage);
  });

  /**
   * Test 2: labels inline object
   *
   * When `labels` is passed as an inline object, it is a new reference every
   * render. Without the fix, this invalidates the mergedLabels useMemo in
   * CopilotChatConfigurationProvider → new context value → all context
   * consumers re-render on every keystroke.
   *
   * LabelConsumerMessage reads directly from useCopilotChatConfiguration(),
   * making it a genuine guard for this fix: context consumers re-render when
   * their context value changes regardless of parent memo boundaries, so
   * labelConsumerRenderCount increases if the labels fix is regressed.
   *
   * Fix: useJsonStable in CopilotChatConfigurationProvider stabilizes the
   * labels reference so the context value doesn't change when the caller
   * passes an inline object.
   */
  it("labels inline object: context consumers do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <div style={{ height: 400 }}>
          <CopilotChat
            messageView={{
              assistantMessage:
                LabelConsumerMessage as unknown as typeof CopilotChatAssistantMessage,
            }}
            // Inline labels object — new reference on every render of the
            // parent. Without the fix, this churns the context value.
            labels={{ chatInputPlaceholder: "Type here..." }}
          />
        </div>
      </CopilotKitProvider>,
    );

    await submitAndReceiveAssistantMessage(agent, "msg-labels-1");

    const renderCountAfterMessage = labelConsumerRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    await act(async () => {});

    expect(labelConsumerRenderCount).toBe(renderCountAfterMessage);
  });
});
