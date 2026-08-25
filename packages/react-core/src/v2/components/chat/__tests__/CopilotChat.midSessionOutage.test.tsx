import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotKitCore } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../../context";
import { CopilotChat } from "../CopilotChat";

/**
 * The third leg of the OSS-904 safety argument, in the binding that owns it.
 *
 * Three decisions hold each other up: preserving runtime knowledge on the way
 * into the error state, preserving it again if the recovery re-sync fails, and
 * keeping the submission gate open throughout. Only a successful runtime
 * request restores the status, and submission in the chat view is gated on a
 * real agent being bound — so if the error state closed the gate, no successful
 * request could ever be issued and the application would be stuck red for the
 * rest of the page's life.
 *
 * Core has coverage for the first two. The third had none in any binding, which
 * is why it is here: this drives the REAL provider, the REAL core and the REAL
 * submit path against a runtime that goes away mid-session, and asserts the
 * state can be left through the user interface rather than through an API call.
 */

const RUNTIME_URL = "http://runtime.test/api";
const INFO_URL = `${RUNTIME_URL}/info`;

const encoder = new TextEncoder();

function sseResponse(): Response {
  const events = [
    { type: "RUN_STARTED", threadId: "t", runId: "r" },
    {
      type: "RUN_FINISHED",
      threadId: "t",
      runId: "r",
      result: { newMessages: [] },
    },
  ];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function infoResponse(): Response {
  return new Response(
    JSON.stringify({
      version: "1.0.0",
      agents: { default: { description: "assistant", capabilities: {} } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("CopilotChat — the submission gate through a mid-session outage", () => {
  const originalFetch = global.fetch;
  let runtimeUp: boolean;
  let runCalls: number;
  let infoCalls: number;

  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    runtimeUp = true;
    runCalls = 0;
    infoCalls = 0;
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url);
      const isInfo = target === INFO_URL;
      if (isInfo) infoCalls += 1;
      else runCalls += 1;
      if (!runtimeUp) {
        throw new TypeError("Failed to fetch");
      }
      return isInfo ? infoResponse() : sseResponse();
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  function CaptureCore({ onCore }: { onCore: (core: CopilotKitCore) => void }) {
    const { copilotkit } = useCopilotKit();
    onCore(copilotkit);
    return null;
  }

  async function type(text: string) {
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function clickSend() {
    fireEvent.click(screen.getByTestId("copilot-send-button"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function send(text: string) {
    await type(text);
    await clickSend();
  }

  it("still offers submission while the status is error, and the state can be left through it", async () => {
    let core: CopilotKitCore | undefined;

    render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} useSingleEndpoint={false}>
        <CaptureCore onCore={(c) => (core = c)} />
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      </CopilotKitProvider>,
    );

    await waitFor(() => {
      expect(core?.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });
    const agent = core!.getAgent("default");
    expect(agent).toBeDefined();

    // The dev server goes away. The user's next message fails and the
    // confirmation check turns the status red.
    runtimeUp = false;
    await send("first message");
    await waitFor(() => {
      expect(core?.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Error,
      );
    });

    // The conversation is still bound to the SAME agent — this is what keeps
    // the gate open, and it is what would be lost if the error state reused the
    // destructive startup failure path.
    expect(core!.getAgent("default")).toBe(agent);

    // The send control is live, not a disabled affordance that silently drops
    // the user's intent. (Asserted with text in the composer: the control is
    // also disabled by an empty composer, which says nothing about the gate.)
    runtimeUp = true;
    await type("retry after the outage");
    const sendButton = screen.getByTestId("copilot-send-button");
    expect(sendButton.hasAttribute("disabled")).toBe(false);
    expect(sendButton.getAttribute("aria-disabled")).not.toBe("true");

    // And sending really does reach the runtime: the dev server has come back
    // and the retry — through the UI, with no API call — restores the status.
    const runCallsBeforeRetry = runCalls;
    await clickSend();

    expect(runCalls).toBeGreaterThan(runCallsBeforeRetry);
    await waitFor(() => {
      expect(core?.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });
    // The recovery re-sync reused the instance, so the open conversation
    // survived the whole round trip.
    expect(core!.getAgent("default")).toBe(agent);
    expect(infoCalls).toBeGreaterThan(1);
  });
});
