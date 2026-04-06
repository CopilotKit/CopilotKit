import React from "react";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  stateSnapshotEvent,
  generateMessages,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import CopilotChatMessageView from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";
import type { Message } from "@ag-ui/core";

// ---------------------------------------------------------------------------
// Spy component — must be module-level so its reference is stable across
// renders. MemoizedAssistantMessage's custom comparator bails out if
// AssistantMessageComponent changes reference, so an unstable spy would
// produce false positives.
// ---------------------------------------------------------------------------
const renderCounts = new Map<string, number>();

const SpyAssistantMessage = (
  props: React.ComponentProps<typeof CopilotChatAssistantMessage>,
) => {
  renderCounts.set(
    props.message.id,
    (renderCounts.get(props.message.id) ?? 0) + 1,
  );
  return React.createElement(CopilotChatAssistantMessage, props);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render CopilotChat with the spy wired in as the assistant message component. */
function renderWithSpy(agent: MockStepwiseAgent) {
  return renderWithCopilotKit({
    agent,
    children: (
      <div style={{ height: 400 }}>
        <CopilotChat
          welcomeScreen={false}
          messageView={
            {
              assistantMessage:
                SpyAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
            } as any
          }
        />
      </div>
    ),
  });
}

/**
 * Submit a dummy user message so CopilotChat calls agent.run() and subscribes
 * to the Subject. Without this, emitted events are dropped since nothing is
 * listening to the observable yet.
 */
async function triggerRun() {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "go" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  // Wait for the user message to appear in the DOM before emitting agent events
  await waitFor(() => {
    expect(screen.getByText("go")).toBeDefined();
  });
}

/**
 * Trigger a run then emit generateMessages(n) and wait for all n assistant
 * messages to have been rendered at least once by the spy.
 */
async function emitBatch(agent: MockStepwiseAgent, n: number) {
  await triggerRun();

  agent.emit(runStartedEvent());
  for (const event of generateMessages(n)) {
    agent.emit(event);
  }
  // Don't call agent.complete() — that terminates the Subject and subsequent
  // agent.emit() calls would be silently dropped. runFinishedEvent() alone is
  // sufficient to mark the run as done without closing the stream.
  agent.emit(runFinishedEvent());

  await waitFor(
    () => {
      expect(renderCounts.size).toBeGreaterThanOrEqual(n);
    },
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Note: the virtual render path (useVirtualizer, activated above VIRTUALIZE_THRESHOLD=50)
// is not exercised here. jsdom always returns clientHeight=0, which causes the
// jsdom guard in CopilotChatMessageView to skip virtualization. The 100-message
// test below runs the flat path even at 100 messages. Browser/Playwright tests
// are required to cover the virtual path.
//
// Note: the MemoizedAssistantMessage comparator is not tested for the case where
// a non-last message's content changes after being committed. A bug returning
// `true` (bail-out) in that scenario would cause stale renders silently.

describe("CopilotChat perf — re-render regression", () => {
  beforeEach(() => {
    renderCounts.clear();
  });

  it("completed messages do not re-render when a new message is added", async () => {
    const agent = new MockStepwiseAgent();
    renderWithSpy(agent);

    await emitBatch(agent, 20);

    const baselineCounts = new Map(renderCounts);
    expect(baselineCounts.size).toBeGreaterThan(0);

    // Add one fresh assistant message in a second run
    const newMsgId = "perf-new-assistant-msg";
    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(newMsgId, "A brand new message"));
    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(renderCounts.get(newMsgId)).toBeGreaterThan(0);
    });

    // None of the original 20 assistant messages should have re-rendered
    for (const [id, count] of baselineCounts) {
      expect(renderCounts.get(id)).toBe(count);
    }
  });

  it("completed messages do not re-render when a state snapshot arrives", async () => {
    const agent = new MockStepwiseAgent();
    renderWithSpy(agent);

    await emitBatch(agent, 10);

    const baselineCounts = new Map(renderCounts);

    // STATE_SNAPSHOT triggers forceUpdate inside CopilotChatMessageView.
    // With deduplicatedMessages memoized on [messages], the same messages
    // array reference is passed down and MemoizedAssistantMessage wrappers
    // should not re-render.
    agent.emit(stateSnapshotEvent({ counter: 1 }));
    agent.emit(stateSnapshotEvent({ counter: 2 }));

    // Flush React's update queue so all snapshot-triggered re-renders are
    // committed before we inspect render counts. The Observable subscription
    // ends after RUN_FINISHED so we cannot use a sentinel message to create a
    // positive signal; act+tick is the idiomatic jsdom alternative.
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
    });

    // None of the original 10 assistant messages should have re-rendered
    for (const [id, count] of baselineCounts) {
      expect(renderCounts.get(id)).toBe(count);
    }
  });

  it("virtual path: renders only a window of messages above VIRTUALIZE_THRESHOLD", async () => {
    const TOTAL = 60; // above VIRTUALIZE_THRESHOLD (50)

    // Create a fake scroll element that passes two jsdom guards:
    // 1. clientHeight > 0 — our guard in CopilotChatMessageView
    // 2. getBoundingClientRect().height > 0 — TanStack Virtual calls this
    //    immediately in observeElementRect() to set the viewport size. Without
    //    this, it overrides initialRect with { height: 0 } and renders no items.
    const fakeScrollEl = document.createElement("div");
    Object.defineProperty(fakeScrollEl, "clientHeight", {
      get: () => 600,
      configurable: true,
    });
    fakeScrollEl.getBoundingClientRect = () =>
      ({
        height: 600,
        width: 800,
        top: 0,
        left: 0,
        bottom: 600,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const messages: Message[] = Array.from({ length: TOTAL }, (_, i) => ({
      id: `virt-msg-${i}`,
      role: "assistant" as const,
      content: `Message ${i}`,
    }));

    const { unmount } = renderWithCopilotKit({
      children: (
        <ScrollElementContext.Provider value={fakeScrollEl}>
          <div style={{ height: 600 }}>
            <CopilotChatMessageView messages={messages} />
          </div>
        </ScrollElementContext.Provider>
      ),
    });

    await waitFor(() => {
      // The virtual container div (position:relative, height = estimateSize × count)
      // must exist — this confirms the virtual code path activated.
      const virtualContainer = document.querySelector(
        '[data-testid="copilot-message-list"] > div[style*="position: relative"]',
      );
      expect(virtualContainer).not.toBeNull();
      // jsdom can't measure the viewport (getBoundingClientRect returns {height:0}
      // for child elements that TanStack Virtual measures internally), so
      // getVirtualItems() returns []. nodes.length === 0, which is still less
      // than TOTAL — virtualization is active even if the window is empty in jsdom.
      const nodes = document.querySelectorAll("[data-message-id]");
      expect(nodes.length).toBeLessThan(TOTAL);
    });

    // Drain pending animation frames before unmounting. TanStack Virtual
    // schedules rAF callbacks for measurement; if they fire after jsdom tears
    // down (window === null) they produce a spurious uncaught exception.
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    unmount();
  });

  it("renders 100 messages without error and within 5 s", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({ agent });

    await triggerRun();

    const start = performance.now();

    agent.emit(runStartedEvent());
    for (const event of generateMessages(100)) {
      agent.emit(event);
    }
    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(
      () => {
        const nodes = document.querySelectorAll("[data-message-id]");
        expect(nodes.length).toBeGreaterThanOrEqual(100);
      },
      { timeout: 5_000 },
    );

    const elapsed = performance.now() - start;
    // 5 000 ms is a generous CI-safe ceiling; the /perf page is the right tool
    // for tighter measurements against browser rendering.
    expect(elapsed).toBeLessThan(5_000);
  });
});
