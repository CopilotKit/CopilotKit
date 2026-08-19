import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../../context";
import { CopilotChat } from "../CopilotChat";
import {
  MockStepwiseAgent,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import type { CopilotKitCore } from "@copilotkit/core";

/**
 * Regression coverage for the fleet-wide "empty assistant response" bug.
 *
 * #5801 (first shipped 1.63.0) deferred the runtime `/info` handshake to a
 * React effect, widening the "provisional agent" window. `useAgent` exposes an
 * `isReady` flag (1.63.2) that is `false` while the provisional stand-in is
 * live and flips `true` once `/info` swaps in the real agent. `CopilotChat`
 * never consumed `isReady`, so a message SENT during the provisional window was
 * committed to the provisional agent (and the composer cleared) and then LOST
 * when `/info` swapped the `agent` reference — surfacing as an empty assistant
 * response.
 *
 * This exercises the real readiness race against the real `CopilotChat` submit
 * path: it holds the runtime in the Connecting/provisional state, sends during
 * that window, then resolves `/info` (the actual status-change re-render that
 * flips `isReady`), and asserts the message survives to produce a rendered
 * assistant response.
 */
describe("CopilotChat readiness gate (empty-assistant-response race)", () => {
  const originalFetch = global.fetch;
  let resolveInfo: ((value: unknown) => void) | undefined;

  beforeEach(() => {
    resolveInfo = undefined;
    // Hold the `/info` handshake open so the runtime stays Connecting and
    // useAgent returns a provisional agent (isReady=false). Any other fetch
    // (e.g. a run dispatched against the provisional agent) hangs harmlessly.
    const infoPromise = new Promise((resolve) => {
      resolveInfo = resolve;
    });
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("/info")) return infoPromise;
      return new Promise(() => {});
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  function CaptureCore({ onCore }: { onCore: (c: CopilotKitCore) => void }) {
    const { copilotkit } = useCopilotKit();
    onCore(copilotkit);
    return null;
  }

  it("does not drop a message sent during the provisional window; the assistant response renders once ready", async () => {
    const realAgent = new MockStepwiseAgent();
    let core: CopilotKitCore | undefined;

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59999/api">
        <CaptureCore onCore={(c) => (core = c)} />
        {/* No explicit threadId -> isConnecting stays false, so the input
            overlay does not confound the readiness gate under test. */}
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotKitProvider>,
    );

    // --- Provisional window (isReady=false): user types and sends ---
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hello during provisional" } });

    // A user click on the send control DURING the provisional window. The fix
    // gates this so nothing is committed to the doomed provisional agent and the
    // composer text is preserved; the buggy build commits it (clearing the
    // composer), losing it on the swap below.
    fireEvent.click(screen.getByTestId("copilot-send-button"));

    // --- Runtime becomes ready ---
    // Register the controllable agent under the resolved id, then resolve
    // `/info` (with no remote agents). Resolving flips the runtime
    // Connecting -> Connected, whose status-change event re-renders the tree;
    // useAgent then finds the real agent via getAgent() and flips isReady=true,
    // swapping out the provisional stand-in — the real `/info` swap.
    act(() => {
      core!.addAgent__unsafe_dev_only({
        id: DEFAULT_AGENT_ID,
        agent: realAgent,
      });
    });
    await act(async () => {
      resolveInfo!({
        // `status` (not just `ok`) is required: the default "auto" transport
        // treats a 2xx GET /info as the REST runtime; without a 2xx status it
        // falls through to the single-endpoint POST and never connects.
        status: 200,
        ok: true,
        json: async () => ({
          version: "1.0.0",
          audioFileTranscriptionEnabled: false,
          agents: {},
        }),
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Send control is enabled now. Click send again WITHOUT re-typing: this
    // relies on the composer still holding the text (the fix's message-
    // preservation guarantee). In the buggy build the composer was cleared on
    // the provisional commit, so this second click sends nothing.
    fireEvent.click(screen.getByTestId("copilot-send-button"));

    // Wait until the message is committed onto the REAL agent (addMessage runs
    // just before onSubmitInput awaits copilotkit.runAgent, so this is a
    // reliable signal that the run is about to subscribe to the agent stream).
    // Body text alone is unreliable here: the textarea's auto-resize mirror
    // echoes the composer contents, so it would report the text before any
    // message is committed.
    //
    // In the BUGGY build this never happens: the provisional click already
    // consumed and cleared the composer, so the second click sends nothing and
    // the real agent never receives the message. Tolerate that here (bounded)
    // so the failure surfaces on the empty-container assertion below rather
    // than on this intermediate wait.
    try {
      await waitFor(
        () => expect(realAgent.messages.length).toBeGreaterThan(0),
        { timeout: 2000 },
      );
    } catch {
      // Buggy build: message was dropped on the provisional->ready swap.
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Drive the real agent's assistant response. emit() wraps each event in
    // act() internally; a trailing flush lets the batched re-render commit.
    const messageId = testId("assistant");
    realAgent.emit(runStartedEvent());
    realAgent.emit(textChunkEvent(messageId, "Hi there! "));
    realAgent.emit(textChunkEvent(messageId, "How can I help?"));
    realAgent.emit(runFinishedEvent());
    realAgent.complete();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // The user's message must have survived the provisional->ready swap and
    // produced a rendered assistant response (non-empty container). The streamed
    // markdown text renders across multiple inline leaf nodes, so assert against
    // the rendered container's text rather than a single-element getByText.
    await waitFor(() => {
      expect(document.body.textContent).toContain("Hi there! How can I help?");
    });
    expect(document.body.textContent).toContain("Hello during provisional");
  });
});
