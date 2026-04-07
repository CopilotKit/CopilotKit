/**
 * Reproduction tests for FOR-75: messageView / labels props freeze
 *
 * These tests prove that passing `messageView` or `labels` as inline props
 * to CopilotChat causes completed assistant messages to re-render on every
 * keystroke — even though the messages haven't changed.
 *
 * Tests FAIL on main before the fix (reproducing the bug).
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
// Helper: submit a user message (triggers agent.run()), then emit a
// complete assistant response and wait for it to appear.
// ---------------------------------------------------------------------------
async function submitAndReceiveAssistantMessage(
  agent: MockStepwiseAgent,
  messageId: string,
  assistantText: string,
) {
  // Submit a user message to trigger agent.run() — this subscribes to the subject
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "hello" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText("hello")).toBeDefined();
  });

  // Now emit the assistant response through the (now-subscribed) subject
  agent.emit({ type: EventType.RUN_STARTED } as BaseEvent);
  agent.emit({
    type: EventType.TEXT_MESSAGE_CHUNK,
    messageId,
    delta: assistantText,
  } as BaseEvent);
  agent.emit({ type: EventType.RUN_FINISHED } as BaseEvent);

  await waitFor(() => {
    expect(screen.getByText(assistantText)).toBeDefined();
  });

  await act(async () => {
    agent.complete();
  });
}

// ---------------------------------------------------------------------------
// Counting component — defined OUTSIDE tests so its reference is stable.
// The surrounding messageView object will be an inline object (new ref every
// render), which is what triggers the bug.
// ---------------------------------------------------------------------------
let assistantRenderCount = 0;
function CountingAssistantMessage(
  _props: React.HTMLAttributes<HTMLDivElement>,
) {
  assistantRenderCount++;
  return <div data-testid="counting-assistant">hello from assistant</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FOR-75: messageView / labels props — no re-renders on input change", () => {
  beforeEach(() => {
    assistantRenderCount = 0;
  });

  /**
   * Test A: messageView inline object
   *
   * When `messageView` is passed as an inline object prop (e.g.
   * `messageView={{ assistantMessage: Cmp }}`), a new object reference is
   * created on every parent render. ts-deepmerge deep-clones the value,
   * producing a new reference that defeats MemoizedSlotWrapper's shallow
   * equality check → CopilotChatView + CopilotChatMessageView re-render on
   * every keystroke → CountingAssistantMessage is called again.
   *
   * Fix: memoize the messageView transformation in CopilotChat.tsx so the
   * slot reference is stable across renders.
   */
  it("messageView inline object: completed messages do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <div style={{ height: 400 }}>
          <CopilotChat
            // Inline object — new reference every render of the test component.
            // The assistantMessage value (CountingAssistantMessage) is stable,
            // but the outer object is cloned by ts-deepmerge on each render.
            messageView={{ assistantMessage: CountingAssistantMessage } as any}
          />
        </div>
      </CopilotKitProvider>,
    );

    await submitAndReceiveAssistantMessage(
      agent,
      "msg-1",
      "hello from assistant",
    );

    const renderCountAfterMessage = assistantRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    // Type into the (now-cleared) input — only inputValue state changes; messages unchanged.
    // Completed messages must NOT re-render.
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    await act(async () => {});

    // KEY ASSERTION: no additional renders caused by typing
    expect(assistantRenderCount).toBe(renderCountAfterMessage);
  });

  /**
   * Test C: labels inline object
   *
   * When `labels` is passed as an inline object, it is a new reference every
   * render. This invalidates the mergedLabels useMemo in
   * CopilotChatConfigurationProvider → new context value → all context
   * consumers re-render on every keystroke.
   *
   * Fix: deep-compare labels dep in CopilotChatConfigurationProvider.
   */
  it("labels inline object: completed messages do not re-render on keystroke", async () => {
    const agent = new MockStepwiseAgent();

    render(
      <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
        <div style={{ height: 400 }}>
          <CopilotChat
            messageView={{ assistantMessage: CountingAssistantMessage } as any}
            // Inline labels object — new reference every render
            labels={{ chatInputPlaceholder: "Type here..." }}
          />
        </div>
      </CopilotKitProvider>,
    );

    await submitAndReceiveAssistantMessage(
      agent,
      "msg-labels-1",
      "hello from assistant",
    );

    const renderCountAfterMessage = assistantRenderCount;
    expect(renderCountAfterMessage).toBeGreaterThan(0);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    await act(async () => {});

    expect(assistantRenderCount).toBe(renderCountAfterMessage);
  });
});
