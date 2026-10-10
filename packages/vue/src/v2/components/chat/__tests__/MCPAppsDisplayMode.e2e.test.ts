/**
 * Vue counterpart of react-core's `MCPAppsRequestDisplayMode.e2e.test.tsx`.
 *
 * The negotiation itself (grant / refuse / host-context notification) is
 * proven at the shared-package level; these cases prove the Vue surface:
 * - fullscreen renders the host exit button and fills the iframe;
 * - the exit button and Escape (dialog `cancel`) return to inline and notify
 *   the widget through `host-context-changed`;
 * - a mode the app did not declare is refused with no surface change;
 * - the page scroll is locked while fullscreen and restored on exit.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import {
  activitySnapshotEvent,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { MCPAppsActivityType } from "../../MCPAppsActivityRenderer";
import CopilotChat from "../CopilotChat.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";

const PROTOCOL_VERSION = "2026-01-26";

/** Only what these cases need: answer resources/read so the widget boots. */
class MockMCPProxyAgent extends AbstractAgent {
  private readonly subject = new Subject<BaseEvent>();
  private bufferedEvents: BaseEvent[] = [];

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    if (this.subject.observers.length === 0) {
      this.bufferedEvents.push(event);
    } else {
      this.subject.next(event);
    }
    await flushVueUpdates();
  }

  clone(): MockMCPProxyAgent {
    const cloned = new MockMCPProxyAgent();
    cloned.agentId = this.agentId;
    type Internal = {
      subject: Subject<BaseEvent>;
      bufferedEvents: BaseEvent[];
    };
    (cloned as unknown as Internal).subject = (
      this as unknown as Internal
    ).subject;
    (cloned as unknown as Internal).bufferedEvents = (
      this as unknown as Internal
    ).bufferedEvents;
    Object.defineProperty(cloned, "isRunning", {
      get: () => this.isRunning,
      set: (v: boolean) => {
        this.isRunning = v;
      },
      configurable: true,
      enumerable: true,
    });
    cloned.run = (input: RunAgentInput) => this.run(input);
    cloned.runAgent = (input?: Partial<RunAgentInput>) => this.runAgent(input);
    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      for (const event of this.bufferedEvents) observer.next(event);
      this.bufferedEvents = [];
      const subscription = this.subject.subscribe(observer);
      return () => subscription.unsubscribe();
    });
  }

  async runAgent(input?: Partial<RunAgentInput>): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | { method: string; params?: Record<string, unknown> }
      | undefined;
    if (proxiedRequest?.method === "resources/read") {
      return {
        result: {
          contents: [
            {
              uri: proxiedRequest.params?.uri,
              mimeType: "text/html",
              text: "<html><body>App</body></html>",
            },
          ],
        },
        newMessages: [],
      };
    }
    if (proxiedRequest) return { result: {}, newMessages: [] };
    return super.runAgent(input);
  }
}

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Render, emit the MCP activity, wait for the iframe and handshake the sandbox. */
async function setupMCPActivity(
  agent: MockMCPProxyAgent,
  userMessage: string,
): Promise<HTMLIFrameElement> {
  const threadId = testId("mcp-display-mode-thread");
  const agentId = agent.agentId ?? "mcp-display-mode-agent";
  agent.agentId = agentId;

  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
    },
    setup() {
      return { agentId, threadId, agents: { [agentId]: agent } };
    },
    template: `
      <CopilotKitProvider runtimeUrl="/api/copilotkit" :agents__unsafe_dev_only="agents">
        <CopilotChatConfigurationProvider :thread-id="threadId" :agent-id="agentId">
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  render(Host);

  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, userMessage);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText(userMessage)).toBeDefined();
  });

  await agent.emit(runStartedEvent());
  await agent.emit(
    activitySnapshotEvent({
      messageId: testId("mcp-activity"),
      activityType: MCPAppsActivityType,
      content: {
        resourceUri: "ui://test/app",
        serverHash: "test-hash",
        toolInput: {},
        result: {
          content: [{ type: "text", text: "Tool output" }],
          isError: false,
        },
      },
    }),
  );
  await agent.emit(runFinishedEvent());

  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );

  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" },
      source: iframe!.contentWindow,
      origin: "",
    }),
  );
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return iframe!;
}

type Outgoing = Record<string, any>;

function spyOnHostMessages(iframe: HTMLIFrameElement) {
  return vi.spyOn(iframe.contentWindow as Window, "postMessage") as unknown as {
    mock: { calls: any[][] };
  };
}

const outgoing = (spy: { mock: { calls: any[][] } }): Outgoing[] =>
  spy.mock.calls.map((c) => c[0] as Outgoing);
const responseFor = (spy: { mock: { calls: any[][] } }, id: string) =>
  outgoing(spy).find((m) => m.id === id && "result" in m);
const contextChanges = (spy: { mock: { calls: any[][] } }) =>
  outgoing(spy)
    .filter((m) => m.method === "ui/notifications/host-context-changed")
    .map((m) => m.params);

async function sendRequest(
  iframe: HTMLIFrameElement,
  method: string,
  params?: Record<string, unknown>,
): Promise<string> {
  const id = testId("req");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, method, params },
      source: iframe.contentWindow,
      origin: "",
    }),
  );
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await flushVueUpdates();
  return id;
}

const requestMode = (iframe: HTMLIFrameElement, mode: string) =>
  sendRequest(iframe, "ui/request-display-mode", { mode });

const sendInitialize = (
  iframe: HTMLIFrameElement,
  appCapabilities: Record<string, unknown> = {},
) =>
  sendRequest(iframe, "ui/initialize", {
    appInfo: { name: "test-app", version: "1.0.0" },
    appCapabilities,
    protocolVersion: PROTOCOL_VERSION,
  });

const exitButton = () =>
  screen.queryByRole("button", { name: "Exit fullscreen" });

describe("MCP Apps ui/request-display-mode (Vue surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("grants fullscreen: exit button, top-layer dialog, iframe filling the surface", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-grant";
    const iframe = await setupMCPActivity(agent, "Fullscreen grant");
    const spy = spyOnHostMessages(iframe);

    const id = await requestMode(iframe, "fullscreen");

    expect(responseFor(spy, id)?.result).toEqual({ mode: "fullscreen" });
    const exit = await screen.findByRole("button", { name: "Exit fullscreen" });
    // Focus lands on the host's exit button, so Escape works right away.
    expect(document.activeElement).toBe(exit);
    const dialog = iframe.closest("dialog");
    expect(dialog?.getAttribute("data-mcp-app-display-mode")).toBe(
      "fullscreen",
    );
    expect(iframe.style.height).toBe("100%");
    expect(contextChanges(spy).map((p) => p.displayMode)).toEqual([
      "fullscreen",
    ]);
  });

  it("the exit button returns to inline and notifies the widget", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-exit-button";
    const iframe = await setupMCPActivity(agent, "Exit button");
    const spy = spyOnHostMessages(iframe);
    await requestMode(iframe, "fullscreen");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Exit fullscreen" }),
    );
    await flushVueUpdates();

    await waitFor(() => expect(exitButton()).toBeNull());
    expect(
      iframe.closest("dialog")?.getAttribute("data-mcp-app-display-mode"),
    ).toBe("inline");
    expect(iframe.style.height).toBe("100px");
    expect(contextChanges(spy)).toEqual([
      expect.objectContaining({ displayMode: "fullscreen" }),
      { displayMode: "inline" },
    ]);
  });

  it("Escape on the modal dialog returns to inline and notifies the widget", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-escape";
    const iframe = await setupMCPActivity(agent, "Escape");
    const spy = spyOnHostMessages(iframe);
    await requestMode(iframe, "fullscreen");
    await screen.findByRole("button", { name: "Exit fullscreen" });

    // Escape on a modal <dialog> fires `cancel`; jsdom does not derive it from
    // a keydown, so dispatch what the browser would.
    const dialog = iframe.closest("dialog")!;
    await fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await flushVueUpdates();

    await waitFor(() => expect(exitButton()).toBeNull());
    expect(contextChanges(spy).map((p) => p.displayMode)).toEqual([
      "fullscreen",
      "inline",
    ]);
  });

  it("refuses a mode the app did not declare and leaves the surface inline", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-refuse";
    const iframe = await setupMCPActivity(agent, "Refusal");
    const spy = spyOnHostMessages(iframe);
    await sendInitialize(iframe, { availableDisplayModes: ["inline"] });

    const id = await requestMode(iframe, "fullscreen");

    expect(responseFor(spy, id)?.result).toEqual({ mode: "inline" });
    expect(exitButton()).toBeNull();
    expect(contextChanges(spy)).toHaveLength(0);
  });

  it("returns the current mode for the unsupported pip mode", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-pip";
    const iframe = await setupMCPActivity(agent, "Pip");
    const spy = spyOnHostMessages(iframe);

    const id = await requestMode(iframe, "pip");

    expect(responseFor(spy, id)?.result).toEqual({ mode: "inline" });
    expect(exitButton()).toBeNull();
    expect(contextChanges(spy)).toHaveLength(0);
  });

  it("returns the CURRENT mode (not inline) when an unavailable mode is requested", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-current";
    const iframe = await setupMCPActivity(agent, "Current mode");
    const spy = spyOnHostMessages(iframe);
    await requestMode(iframe, "fullscreen");

    const pipId = await requestMode(iframe, "pip");

    // An unavailable request must not switch and answers with the mode still
    // applied, so the surface stays fullscreen.
    expect(responseFor(spy, pipId)?.result).toEqual({ mode: "fullscreen" });
    expect(exitButton()).not.toBeNull();
  });

  it("grants fullscreen when the View declares it in appCapabilities", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-declared";
    const iframe = await setupMCPActivity(agent, "Declared grant");
    const spy = spyOnHostMessages(iframe);
    await sendInitialize(iframe, {
      availableDisplayModes: ["inline", "fullscreen"],
    });

    const id = await requestMode(iframe, "fullscreen");

    expect(responseFor(spy, id)?.result).toEqual({ mode: "fullscreen" });
    expect(
      await screen.findByRole("button", { name: "Exit fullscreen" }),
    ).toBeDefined();
    expect(contextChanges(spy).map((p) => p.displayMode)).toContain(
      "fullscreen",
    );
  });

  it("emits host-context-changed for widget-initiated changes (fullscreen then inline)", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-roundtrip";
    const iframe = await setupMCPActivity(agent, "Round trip");
    const spy = spyOnHostMessages(iframe);

    await requestMode(iframe, "fullscreen");
    const backId = await requestMode(iframe, "inline");

    expect(responseFor(spy, backId)?.result).toEqual({ mode: "inline" });
    await waitFor(() => expect(exitButton()).toBeNull());
    // The app SDK caches host context from the notification, not from the
    // response, so a widget-initiated change must also emit it.
    const changes = contextChanges(spy);
    expect(changes.map((p) => p.displayMode)).toEqual(["fullscreen", "inline"]);
    // Entering fullscreen advertises the surface; inline carries no dimensions.
    expect(changes[0].containerDimensions).toEqual({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(changes[1].containerDimensions).toBeUndefined();
  });

  it("advertises displayMode and availableDisplayModes at ui/initialize", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-initialize";
    const iframe = await setupMCPActivity(agent, "Initialize");
    const spy = spyOnHostMessages(iframe);

    const id = await sendInitialize(iframe);

    expect(responseFor(spy, id)?.result?.hostContext).toMatchObject({
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
    });
  });

  it("advertises containerDimensions and fills the iframe in fullscreen", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-surface";
    const iframe = await setupMCPActivity(agent, "Surface");
    const spy = spyOnHostMessages(iframe);

    await requestMode(iframe, "fullscreen");

    const [entered] = contextChanges(spy);
    expect(entered.displayMode).toBe("fullscreen");
    expect(entered.containerDimensions).toEqual({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(iframe.style.height).toBe("100%");
  });

  it("locks the page scroll while fullscreen and restores it on exit", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = "dm-scroll";
    const iframe = await setupMCPActivity(agent, "Scroll lock");
    spyOnHostMessages(iframe);
    expect(document.body.style.overflow).toBe("");

    await requestMode(iframe, "fullscreen");
    expect(document.body.style.overflow).toBe("hidden");

    await fireEvent.click(
      await screen.findByRole("button", { name: "Exit fullscreen" }),
    );
    await flushVueUpdates();
    await waitFor(() => expect(document.body.style.overflow).toBe(""));
  });
});
