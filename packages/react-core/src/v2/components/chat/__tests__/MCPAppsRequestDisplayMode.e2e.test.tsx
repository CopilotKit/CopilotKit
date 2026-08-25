/**
 * Tests for the MCP Apps ui/request-display-mode host handler.
 *
 * Verifies (ext-apps 2026-01-26):
 * - ui/request-display-mode returns the mode actually applied.
 * - "fullscreen" is granted; "pip" and unknown values fall back to "inline".
 * - ui/initialize advertises displayMode + availableDisplayModes in hostContext.
 * - Fullscreen renders a host close (X) button; clicking it OR pressing Escape
 *   returns to inline AND emits ui/notifications/host-context-changed.
 * - The background page scroll is locked while fullscreen and restored on exit.
 */
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import {
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { MCPAppsActivityType } from "../../../components/MCPAppsActivityRenderer";
import type { RunAgentInput, RunAgentResult, BaseEvent } from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";

/**
 * Minimal MockMCPProxyAgent, mirroring MCPAppsUiMessage.e2e.test.tsx: it only
 * needs to answer resources/read so the iframe is created and the host message
 * handler is installed.
 */
class MockMCPProxyAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  private runAgentResponses: Map<string, unknown> = new Map();

  setRunAgentResponse(method: string, response: unknown) {
    this.runAgentResponses.set(method, response);
  }

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

  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }

  async runAgent(input?: Partial<RunAgentInput>): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | { method: string; params?: Record<string, unknown> }
      | undefined;

    if (proxiedRequest) {
      const response = this.runAgentResponses.get(proxiedRequest.method);
      if (response !== undefined) {
        return { result: response, newMessages: [] };
      }
      if (proxiedRequest.method === "resources/read") {
        return {
          result: {
            contents: [
              {
                uri: proxiedRequest.params?.uri,
                mimeType: "text/html",
                text: "<html><body>Test content</body></html>",
              },
            ],
          },
          newMessages: [],
        };
      }
      return { result: {}, newMessages: [] };
    }

    return super.runAgent(input);
  }
}

function mcpAppsActivityContent() {
  return {
    resourceUri: "ui://test/app",
    serverHash: "test-hash",
    toolInput: {},
    result: {
      content: [{ type: "text", text: "Tool output" }],
      isError: false,
    },
  };
}

/**
 * Render, emit MCP activity, wait for iframe creation, then simulate
 * sandbox-proxy-ready so the host message handler is installed.
 */
async function setupMCPActivity(
  agent: MockMCPProxyAgent,
  agentId: string,
): Promise<HTMLIFrameElement> {
  agent.setRunAgentResponse("resources/read", {
    contents: [
      {
        uri: "ui://test/app",
        mimeType: "text/html",
        text: "<html><body>App</body></html>",
      },
    ],
  });

  const threadId = testId("thread");

  renderWithCopilotKit({
    agents: { [agentId]: agent },
    agentId,
    threadId,
  });

  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "display mode test" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText("display mode test")).toBeDefined();
  });

  agent.emit(runStartedEvent());
  agent.emit(
    activitySnapshotEvent({
      messageId: testId("mcp-activity"),
      activityType: MCPAppsActivityType,
      content: mcpAppsActivityContent(),
    }),
  );
  agent.emit(runFinishedEvent());

  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );

  const readyEvent = new MessageEvent("message", {
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
    },
    source: iframe!.contentWindow,
    origin: "",
  });

  await act(async () => {
    window.dispatchEvent(readyEvent);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  return iframe!;
}

type OutgoingMessage = Record<string, any>;

/**
 * Spy on the messages the host posts to the iframe (responses + notifications).
 */
function spyOnHostMessages(iframe: HTMLIFrameElement) {
  return vi.spyOn(
    iframe.contentWindow as Window,
    "postMessage",
  ) as unknown as { mock: { calls: any[][] } };
}

function outgoing(spy: { mock: { calls: any[][] } }): OutgoingMessage[] {
  return spy.mock.calls.map((c) => c[0] as OutgoingMessage);
}

/**
 * Dispatch a JSON-RPC request from the iframe and wait for the host to handle it.
 */
async function sendRequest(
  iframe: HTMLIFrameElement,
  method: string,
  params?: Record<string, unknown>,
): Promise<string> {
  const id = testId("req");
  const msg = new MessageEvent("message", {
    data: { jsonrpc: "2.0", id, method, params },
    source: iframe.contentWindow,
    origin: "",
  });
  await act(async () => {
    window.dispatchEvent(msg);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return id;
}

function responseFor(
  spy: { mock: { calls: any[][] } },
  id: string,
): OutgoingMessage | undefined {
  return outgoing(spy).find((m) => m.id === id && "result" in m);
}

function notificationsFor(
  spy: { mock: { calls: any[][] } },
  method: string,
): OutgoingMessage[] {
  return outgoing(spy).filter((m) => m.method === method && !("id" in m));
}

describe("MCP Apps ui/request-display-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  it("grants fullscreen and replies with the applied mode", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-fullscreen";
    const iframe = await setupMCPActivity(agent, "rdm-fullscreen");
    const spy = spyOnHostMessages(iframe);

    const id = await sendRequest(iframe, "ui/request-display-mode", {
      mode: "fullscreen",
    });

    expect(responseFor(spy, id)?.result).toEqual({ mode: "fullscreen" });
    // No -32601 error and no error field on the response.
    expect(responseFor(spy, id)).not.toHaveProperty("error");
  });

  it("falls back to inline for the unsupported pip mode", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-pip";
    const iframe = await setupMCPActivity(agent, "rdm-pip");
    const spy = spyOnHostMessages(iframe);

    const id = await sendRequest(iframe, "ui/request-display-mode", {
      mode: "pip",
    });

    expect(responseFor(spy, id)?.result).toEqual({ mode: "inline" });
  });

  it("falls back to inline for an unknown / absent mode", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-unknown";
    const iframe = await setupMCPActivity(agent, "rdm-unknown");
    const spy = spyOnHostMessages(iframe);

    const unknownId = await sendRequest(iframe, "ui/request-display-mode", {
      mode: "sidebar" as unknown as string,
    });
    const absentId = await sendRequest(iframe, "ui/request-display-mode", {});

    expect(responseFor(spy, unknownId)?.result).toEqual({ mode: "inline" });
    expect(responseFor(spy, absentId)?.result).toEqual({ mode: "inline" });
  });

  it("emits host-context-changed for widget-initiated changes (fullscreen then inline)", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-roundtrip";
    const iframe = await setupMCPActivity(agent, "rdm-roundtrip");
    const spy = spyOnHostMessages(iframe);

    await sendRequest(iframe, "ui/request-display-mode", { mode: "fullscreen" });
    const backId = await sendRequest(iframe, "ui/request-display-mode", {
      mode: "inline",
    });

    expect(responseFor(spy, backId)?.result).toEqual({ mode: "inline" });

    // The app SDK caches hostContext only from the notification, so a
    // widget-initiated change must ALSO emit host-context-changed (not just the
    // response) or the widget's own toggle can never return to inline.
    const notifs = notificationsFor(
      spy,
      "ui/notifications/host-context-changed",
    );
    expect(notifs.map((n) => n.params.displayMode)).toEqual([
      "fullscreen",
      "inline",
    ]);
    // Entering fullscreen advertises the available render surface.
    expect(notifs[0].params.containerDimensions).toEqual(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
    // Inline carries no container dimensions.
    expect(notifs[1].params.containerDimensions).toBeUndefined();
  });

  it("advertises displayMode and availableDisplayModes at ui/initialize", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-initialize";
    const iframe = await setupMCPActivity(agent, "rdm-initialize");
    const spy = spyOnHostMessages(iframe);

    const id = await sendRequest(iframe, "ui/initialize", {});

    const hostContext = responseFor(spy, id)?.result?.hostContext;
    expect(hostContext?.displayMode).toBe("inline");
    expect(hostContext?.availableDisplayModes).toEqual([
      "inline",
      "fullscreen",
    ]);
  });

  it("shows a close button in fullscreen; clicking it exits and notifies the widget", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-close-button";
    const iframe = await setupMCPActivity(agent, "rdm-close-button");
    const spy = spyOnHostMessages(iframe);

    await sendRequest(iframe, "ui/request-display-mode", { mode: "fullscreen" });

    const closeButton = await screen.findByRole("button", {
      name: "Exit fullscreen",
    });
    expect(closeButton).toBeDefined();

    await act(async () => {
      fireEvent.click(closeButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Back to inline: the close button is gone.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Exit fullscreen" }),
      ).toBeNull();
    });

    // One notification for entering fullscreen, one for the host-initiated exit.
    const notifications = notificationsFor(
      spy,
      "ui/notifications/host-context-changed",
    );
    expect(notifications).toHaveLength(2);
    expect(notifications[0].params.displayMode).toBe("fullscreen");
    expect(notifications[1].params).toEqual({ displayMode: "inline" });
  });

  it("exits fullscreen on Escape and notifies the widget", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-escape";
    const iframe = await setupMCPActivity(agent, "rdm-escape");
    const spy = spyOnHostMessages(iframe);

    await sendRequest(iframe, "ui/request-display-mode", { mode: "fullscreen" });
    await screen.findByRole("button", { name: "Exit fullscreen" });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Exit fullscreen" }),
      ).toBeNull();
    });

    // One notification for entering fullscreen, one for the Escape-driven exit.
    const notifications = notificationsFor(
      spy,
      "ui/notifications/host-context-changed",
    );
    expect(notifications).toHaveLength(2);
    expect(notifications[0].params.displayMode).toBe("fullscreen");
    expect(notifications[1].params).toEqual({ displayMode: "inline" });
  });

  it("advertises containerDimensions and fills the iframe in fullscreen", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-surface";
    const iframe = await setupMCPActivity(agent, "rdm-surface");
    const spy = spyOnHostMessages(iframe);

    await sendRequest(iframe, "ui/request-display-mode", { mode: "fullscreen" });

    const notifs = notificationsFor(
      spy,
      "ui/notifications/host-context-changed",
    );
    expect(notifs[0].params.displayMode).toBe("fullscreen");
    expect(notifs[0].params.containerDimensions).toEqual(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
    // The iframe must fill the overlay, not keep its widget-reported height.
    expect(iframe.style.height).toBe("100%");
  });

  it("locks the background scroll while fullscreen and restores it on exit", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "rdm-scroll-lock";
    const iframe = await setupMCPActivity(agent, "rdm-scroll-lock");
    spyOnHostMessages(iframe);

    expect(document.body.style.overflow).toBe("");

    await sendRequest(iframe, "ui/request-display-mode", { mode: "fullscreen" });
    expect(document.body.style.overflow).toBe("hidden");

    const closeButton = await screen.findByRole("button", {
      name: "Exit fullscreen",
    });
    await act(async () => {
      fireEvent.click(closeButton);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.body.style.overflow).toBe("");
  });
});
