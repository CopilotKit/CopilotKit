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
import { useConfigureSuggestions } from "../../../hooks/use-configure-suggestions";

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

/**
 * Companion coverage for the suggestion-submission arm of the readiness gate.
 *
 * The same provisional-agent window that dropped a typed message also affects
 * static `available:"always"` suggestion pills: they render on the welcome
 * screen BEFORE `/info` resolves, so a pill selected during that window would
 * commit `suggestion.message` to the doomed provisional agent (and run against
 * it) — lost on the swap, surfacing as an empty assistant response. The fix
 * withholds `onSelectSuggestion` until `isReady`, making the pill click a
 * no-op during the provisional window and live once the real agent is bound.
 */
describe("CopilotChat readiness gate — suggestion submission", () => {
  const originalFetch = global.fetch;
  let resolveInfo: ((value: unknown) => void) | undefined;

  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    resolveInfo = undefined;
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

  const STATIC_SUGGESTIONS = [{ title: "Say hello", message: "Hello there!" }];

  function ChatWithAlwaysSuggestions() {
    useConfigureSuggestions({
      suggestions: STATIC_SUGGESTIONS,
      available: "always",
      consumerAgentId: DEFAULT_AGENT_ID,
    });
    return <CopilotChat />;
  }

  it("does not commit a suggestion selected during the provisional window; it works once ready", async () => {
    const realAgent = new MockStepwiseAgent();
    let core: CopilotKitCore | undefined;

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59998/api">
        <CaptureCore onCore={(c) => (core = c)} />
        <div style={{ height: 400 }}>
          <ChatWithAlwaysSuggestions />
        </div>
      </CopilotKitProvider>,
    );

    // --- Provisional window (isReady=false): the static pill is rendered ---
    const pill = await screen.findByText("Say hello");

    // A user click on the suggestion DURING the provisional window. The fix
    // withholds onSelectSuggestion, so the click is a no-op and nothing is
    // committed to the doomed provisional agent. The buggy build commits
    // `suggestion.message` to the provisional agent (which is the agent
    // currently rendered by CopilotChat), so its text appears in the DOM.
    fireEvent.click(pill);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Discriminator: the suggestion's MESSAGE ("Hello there!", distinct from
    // the pill's TITLE "Say hello") must NOT have been committed. In the buggy
    // build it renders as a user message on the provisional agent → present.
    expect(document.body.textContent).not.toContain("Hello there!");

    // --- Runtime becomes ready (real agent swapped in) ---
    act(() => {
      core!.addAgent__unsafe_dev_only({
        id: DEFAULT_AGENT_ID,
        agent: realAgent,
      });
    });
    await act(async () => {
      resolveInfo!({
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

    // Now ready: the pill is live. Selecting it commits to the REAL agent and
    // runs, producing a rendered response.
    const readyPill = await screen.findByText("Say hello");
    fireEvent.click(readyPill);

    await waitFor(() => expect(realAgent.messages.length).toBeGreaterThan(0), {
      timeout: 2000,
    });

    const messageId = testId("assistant");
    realAgent.emit(runStartedEvent());
    realAgent.emit(textChunkEvent(messageId, "Hi from suggestion!"));
    realAgent.emit(runFinishedEvent());
    realAgent.complete();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Hi from suggestion!");
    });
    // The suggestion's message survived to the real agent as a user message.
    expect(document.body.textContent).toContain("Hello there!");
  });
});

/**
 * Production-shaped regression for the readiness gate that crosses the real
 * network → SSE transport boundary (rather than injecting a controllable agent
 * and emitting events directly). A public `<CopilotKit runtimeUrl=...>` drives
 * the single-endpoint transport: a mocked `fetch` serves runtime `info` and
 * `agent/run`, and `agent/run` streams a real `text/event-stream` body of
 * AG-UI frames (RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT →
 * TEXT_MESSAGE_END → RUN_FINISHED). This exercises the same provisional-window
 * race end-to-end: with the gate absent the send committed to the provisional
 * agent (clearing the composer), so the second click — against an empty
 * composer whose send control is disabled — never runs and the assistant
 * container stays empty. With the gate, the first click is a no-op that
 * preserves the composer text, and the second (post-`/info`) click runs over
 * the real transport, rendering the streamed assistant message.
 */
describe("CopilotChat readiness gate — production-shaped SSE transport", () => {
  const RUNTIME_URL = "http://localhost:59997/api/copilotkit";
  const originalFetch = global.fetch;
  let resolveInfo: ((value: Response) => void) | undefined;
  let agentRunCalls = 0;

  const encoder = new TextEncoder();

  function makeSseResponse(): Response {
    const messageId = "assistant-sse-1";
    const events = [
      { type: "RUN_STARTED", threadId: "mock-thread-id", runId: "run-1" },
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "Hi there! " },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "How can I help?" },
      { type: "TEXT_MESSAGE_END", messageId },
      {
        type: "RUN_FINISHED",
        threadId: "mock-thread-id",
        runId: "run-1",
        result: { newMessages: [] },
      },
    ];
    const payload = events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    resolveInfo = undefined;
    agentRunCalls = 0;
    // Hold the single-endpoint `info` handshake open so the runtime stays
    // Connecting and useAgent returns a provisional agent (isReady=false).
    const infoPromise = new Promise<Response>((resolve) => {
      resolveInfo = resolve;
    });
    global.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method;
      // Auto-detect tries REST GET /info first; 404 forces the single-endpoint
      // POST transport the reviewer asked us to exercise.
      if (u.endsWith("/info") && method !== "POST") {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      if (u === RUNTIME_URL && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          method?: string;
        };
        if (body.method === "info") return infoPromise;
        if (body.method === "agent/run") {
          agentRunCalls += 1;
          return Promise.resolve(makeSseResponse());
        }
      }
      // Any other request (e.g. a provisional-agent run in the buggy build)
      // hangs harmlessly.
      return new Promise(() => {});
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("streams the assistant response over the real transport after a send during the provisional window", async () => {
    render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotKitProvider>,
    );

    // --- Provisional window (isReady=false): user types and sends ---
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hello during provisional" } });
    // Buggy build: commits to the provisional agent AND clears the composer.
    // Fixed build: gated no-op that preserves the composer text.
    fireEvent.click(screen.getByTestId("copilot-send-button"));

    // --- Resolve the single-endpoint `info` → runtime Connected, real agent
    // discovered from `agents: { default }`, isReady flips true. ---
    await act(async () => {
      resolveInfo!(
        new Response(
          JSON.stringify({
            version: "1.0.0",
            audioFileTranscriptionEnabled: false,
            agents: { [DEFAULT_AGENT_ID]: { description: "Default agent" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    // Second click WITHOUT re-typing. In the fixed build the composer still
    // holds the text (canSend is true) so this runs over the real transport;
    // in the buggy build the composer was cleared, the send control is disabled,
    // and nothing runs.
    fireEvent.click(screen.getByTestId("copilot-send-button"));

    // The user message must have survived and produced a rendered assistant
    // message streamed over the real SSE transport.
    await waitFor(
      () => {
        const el = document.querySelector(
          '[data-testid="copilot-assistant-message"]',
        );
        expect(el?.textContent ?? "").toContain("Hi there! How can I help?");
      },
      { timeout: 3000 },
    );
    expect(document.body.textContent).toContain("Hello during provisional");
    // Proves the run crossed the transport boundary (not a directly-emitted
    // event): exactly one agent/run POST reached the mocked runtime.
    expect(agentRunCalls).toBe(1);
  });
});
