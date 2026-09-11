import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { bindMcpApp } from "../session";
import type { McpAppSession } from "../session";
import type { MCPAppsActivityContent } from "../content-schema";

// ---------------------------------------------------------------------------
// Minimal agent mock: only what bindMcpApp + the request queue touch.
// ---------------------------------------------------------------------------
function makeAgent(overrides?: Partial<Record<string, unknown>>) {
  const addMessageCalls: Array<{ id: string; role: string; content: string }> =
    [];
  const runAgentCalls: Array<any> = [];
  const agent = {
    agentId: "test-agent",
    threadId: "thread-1",
    isRunning: false,
    addMessageCalls,
    runAgentCalls,
    addMessage(msg: { id: string; role: string; content: string }) {
      addMessageCalls.push(msg);
    },
    subscribe() {
      return { unsubscribe() {} };
    },
    async runAgent(input?: any) {
      runAgentCalls.push(input);
      const req = input?.forwardedProps?.__proxiedMCPRequest;
      if (req?.method === "resources/read") {
        return {
          result: {
            contents: [
              {
                uri: req.params?.uri,
                mimeType: "text/html",
                text: "<html><body>Widget</body></html>",
              },
            ],
          },
          newMessages: [],
        };
      }
      if (req?.method === "tools/call") {
        return {
          result: {
            content: [{ type: "text", text: "tool ok" }],
            isError: false,
          },
          newMessages: [],
        };
      }
      return { result: {}, newMessages: [] };
    },
    ...overrides,
  };
  return agent as unknown as AbstractAgent & {
    addMessageCalls: typeof addMessageCalls;
    runAgentCalls: typeof runAgentCalls;
  };
}

function makeContent(
  over?: Partial<MCPAppsActivityContent>,
): MCPAppsActivityContent {
  return {
    resourceUri: "ui://test/app",
    serverHash: "hash-123",
    result: { content: [], isError: false },
    toolInput: {},
    ...over,
  } as MCPAppsActivityContent;
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Dispatch a JSON-RPC message from the iframe (source = its contentWindow). */
function fromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow,
      origin: "",
    }),
  );
}

/** Capture messages the host posts back to the iframe. */
function captureOutgoing(iframe: HTMLIFrameElement) {
  const captured: any[] = [];
  const cw = iframe.contentWindow as Window;
  const orig = cw.postMessage.bind(cw);
  cw.postMessage = ((message: unknown, ...args: unknown[]) => {
    captured.push(message);
    return (orig as any)(message, ...args);
  }) as typeof cw.postMessage;
  return captured;
}

let sessions: McpAppSession[] = [];
let iframes: HTMLIFrameElement[] = [];

function mount() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframes.push(iframe);
  return iframe;
}

/**
 * Bind + wait for setup (resource fetch + connect) + simulate the sandbox proxy
 * ready handshake, mirroring the react-core MCP e2e harness.
 */
async function bindAndConnect(
  iframe: HTMLIFrameElement,
  agent: AbstractAgent,
  content = makeContent(),
  hooks?: Parameters<typeof bindMcpApp>[0]["hooks"],
) {
  const session = bindMcpApp({
    iframe,
    getContent: () => content,
    getAgent: () => agent,
    host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
    hooks,
  });
  sessions.push(session);
  await tick(60); // let fetchResource + bridge.connect settle
  const captured = captureOutgoing(iframe);
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
  });
  await tick(30);
  return { session, captured };
}

afterEach(() => {
  sessions.forEach((s) => s.teardown());
  sessions = [];
  iframes.forEach((f) => f.remove());
  iframes = [];
  vi.restoreAllMocks();
});

describe("bindMcpApp", () => {
  it("fetches the resource through the agent and loads the sandbox", async () => {
    const agent = makeAgent();
    const iframe = mount();
    await bindAndConnect(iframe, agent);

    const readCall = agent.runAgentCalls.find(
      (c) =>
        c?.forwardedProps?.__proxiedMCPRequest?.method === "resources/read",
    );
    expect(readCall).toBeDefined();
    expect(iframe.getAttribute("data-testid")).toBe("mcp-app-iframe");
    expect(iframe.srcdoc).toContain("sandbox-proxy-ready");
  });

  it("proxies tools/call through the agent and returns the result to the iframe", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);

    const id = "call-1";
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "do_thing", arguments: { a: 1 } },
    });
    await tick(40);

    const toolCall = agent.runAgentCalls.find(
      (c) => c?.forwardedProps?.__proxiedMCPRequest?.method === "tools/call",
    );
    expect(toolCall).toBeDefined();
    const response = captured.find((m) => m && m.id === id && "result" in m);
    expect(response?.result?.content?.[0]?.text).toBe("tool ok");
  });

  it("opens https links and blocks javascript: links (ui/open-link)", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "ok",
      method: "ui/open-link",
      params: { url: "https://example.com" },
    });
    await tick(20);
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );

    openSpy.mockClear();
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "bad",
      // eslint-disable-next-line no-script-url
      method: "ui/open-link",
      params: { url: "javascript:alert(1)" },
    });
    await tick(20);
    expect(openSpy).not.toHaveBeenCalled();
    const badResp = captured.find((m) => m && m.id === "bad" && "result" in m);
    expect(badResp?.result).toMatchObject({ isError: true });
  });

  it("adds a ui/message to the agent (role from _meta.copilotkit)", async () => {
    const agent = makeAgent();
    const iframe = mount();
    await bindAndConnect(iframe, agent);

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "msg-1",
      method: "ui/message",
      params: {
        content: [{ type: "text", text: "hello from widget" }],
        _meta: { copilotkit: { role: "assistant", followUp: false } },
      },
    });
    await tick(30);

    const call = agent.addMessageCalls.find(
      (c) => c.content === "hello from widget",
    );
    expect(call).toBeDefined();
    expect(call?.role).toBe("assistant");
  });

  it("fires onInitialized when the widget reports initialized", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const onInitialized = vi.fn();
    const { session } = await bindAndConnect(iframe, agent, makeContent(), {
      onInitialized,
    });

    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    });
    await tick(20);
    expect(onInitialized).toHaveBeenCalled();

    // tool input pushed after initialize reaches the iframe
    session.sendToolInput({ a: 1 });
    await tick(10);
  });
});

// ---------------------------------------------------------------------------
// ui/initialize is handled entirely by the ext-apps AppBridge that bindMcpApp
// constructs. These tests pin the negotiation contract at the package level (the
// compile-time tie to the spec the extraction argues for), because the host
// setup lives here now:
// - the bridge validates params against the spec schema, so a widget that omits
//   the required fields (e.g. appCapabilities) fails initialize with -32603;
// - the host advertises only the latest MCP Apps protocol version, so a widget
//   declaring a different version string gets the host version back;
// - the host context seeded at AppBridge construction is advertised at
//   initialize (deterministic, not a post-connect race).
// ---------------------------------------------------------------------------
describe("bindMcpApp ui/initialize negotiation", () => {
  const LATEST_PROTOCOL_VERSION = "2026-01-26";

  it("negotiates and returns the host context for a well-formed initialize", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);

    const reqId = "init-ok";
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: reqId,
      method: "ui/initialize",
      params: {
        appInfo: { name: "test-widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    });
    await tick(30);

    const response = captured.find(
      (m) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
    );
    expect(response).toBeDefined();
    expect(response).not.toHaveProperty("error");
    // Protocol version is negotiated to the host's latest.
    expect(response.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    // Host context seeded at construction is advertised at initialize.
    expect(response.result.hostContext).toMatchObject({
      theme: "light",
      platform: "web",
    });
  });

  it("rejects an initialize that omits required fields with -32603", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);

    // Empty params: no appInfo / appCapabilities / protocolVersion. The bridge
    // validates against the spec schema and rejects before any host handler.
    const reqId = "init-bad";
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: reqId,
      method: "ui/initialize",
      params: {},
    });
    await tick(30);

    const errorResponse = captured.find(
      (m) => m && m.jsonrpc === "2.0" && m.id === reqId && m.error,
    );
    expect(errorResponse).toBeDefined();
    expect(errorResponse.error.code).toBe(-32603);
    expect(typeof errorResponse.error.message).toBe("string");
    expect(errorResponse.error.message.length).toBeGreaterThan(0);
  });

  it("returns the host protocol version, not the widget's, when they differ", async () => {
    const agent = makeAgent();
    const iframe = mount();
    const { captured } = await bindAndConnect(iframe, agent);

    // "2025-06-18" is a base-MCP-protocol version (and what the old hand-rolled
    // Vue/Angular hosts hardcode). The bridge supports only its own MCP Apps
    // version and returns that, rather than echoing the widget's.
    const reqId = "init-version";
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: reqId,
      method: "ui/initialize",
      params: {
        appInfo: { name: "legacy-widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2025-06-18",
      },
    });
    await tick(30);

    const response = captured.find(
      (m) => m && m.jsonrpc === "2.0" && m.id === reqId && m.result,
    );
    expect(response).toBeDefined();
    expect(response.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});

// ---------------------------------------------------------------------------
// F8: self-driving mode. When `messageId` is set, bindMcpApp subscribes to the
// agent's activity stream, filters by that id, and pushes tool input/result to
// the widget itself (the adapter no longer forwards them).
// ---------------------------------------------------------------------------
describe("bindMcpApp self-subscription (messageId)", () => {
  /** Agent mock that captures the subscriber so the test can emit activity events. */
  function makeSubscribingAgent() {
    const base = makeAgent();
    let subscriber: any = null;
    const unsubscribe = vi.fn();
    (base as any).subscribe = (s: any) => {
      subscriber = s;
      return { unsubscribe };
    };
    return {
      agent: base,
      unsubscribe,
      get hasSubscriber() {
        return subscriber !== null;
      },
    };
  }

  function bindSelfDriving(
    iframe: HTMLIFrameElement,
    agent: AbstractAgent,
    content: MCPAppsActivityContent,
  ) {
    const session = bindMcpApp({
      iframe,
      getContent: () => content,
      getAgent: () => agent,
      host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
      messageId: "act-1",
    });
    sessions.push(session);
    return session;
  }

  async function connect(iframe: HTMLIFrameElement) {
    await tick(60);
    const captured = captureOutgoing(iframe);
    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
    });
    await tick(30);
    // Widget reports initialized so buffered pushes flush.
    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    });
    await tick(20);
    return captured;
  }

  it("pushes the initial tool input/result on initialize (from the message store)", async () => {
    const { agent } = makeSubscribingAgent();
    const content = makeContent({
      toolInput: { a: 1 },
      result: { content: [{ type: "text", text: "r" }], isError: false },
    });
    // Init reads the CURRENT activity from agent.messages, not the getContent()
    // prop - so the store must hold the activity message.
    (agent as any).messages = [
      { id: "act-1", role: "activity", activityType: "mcp-apps", content },
    ];
    const iframe = mount();
    bindSelfDriving(iframe, agent, content);
    const captured = await connect(iframe);

    const input = captured.find(
      (m) => m && m.method === "ui/notifications/tool-input",
    );
    const result = captured.find(
      (m) => m && m.method === "ui/notifications/tool-result",
    );
    expect(input?.params?.arguments).toEqual({ a: 1 });
    expect(result).toBeDefined();
  });

  it.each(["before", "after"])(
    "ignores stale syncContent props %s initialization when the activity is in the store",
    async (timing) => {
      const { agent } = makeSubscribingAgent();
      const current = makeContent({
        toolInput: { city: "Paris" },
        result: { content: [{ type: "text", text: "Current forecast" }] },
      });
      const stale = makeContent({
        toolInput: { city: "London" },
        result: { content: [{ type: "text", text: "Old forecast" }] },
      });
      agent.messages = [
        {
          id: "act-1",
          role: "activity",
          activityType: "mcp-apps",
          content: current,
        },
      ];
      const iframe = mount();
      const session = bindSelfDriving(iframe, agent, stale);

      if (timing === "before") session.syncContent(stale);
      const captured = await connect(iframe);
      if (timing === "after") session.syncContent(stale);
      await tick(20);

      // Assert the complete notification history: even a temporary stale send
      // followed by the correct store value would overwrite the widget's state.
      expect(
        captured
          .filter((m) => m.method === "ui/notifications/tool-input")
          .map((m) => m.params.arguments),
      ).toEqual([current.toolInput]);
      expect(
        captured
          .filter((m) => m.method === "ui/notifications/tool-result")
          .map((m) => m.params),
      ).toEqual([current.result]);
    },
  );

  // Content forwarding on activity updates (snapshot / delta / messages-snapshot)
  // is covered against the real AG-UI pipeline below; mock-emitting the activity
  // callbacks would hide the pre-apply-content bug that motivated onMessagesChanged.

  it("unsubscribes from the agent on teardown", async () => {
    const sub = makeSubscribingAgent();
    const iframe = mount();
    const session = bindSelfDriving(
      iframe,
      sub.agent,
      makeContent({ toolInput: undefined }),
    );
    await connect(iframe);
    expect(sub.hasSubscriber).toBe(true);

    session.teardown();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it("forwards content via syncContent when the activity is absent from agent.messages (external messages list)", async () => {
    const sub = makeSubscribingAgent(); // agent.messages is empty
    const iframe = mount();
    const session = bindSelfDriving(
      iframe,
      sub.agent,
      makeContent({ toolInput: undefined }),
    );
    const captured = await connect(iframe);
    // The activity is not in the store, so the subscription/init pushed nothing.
    expect(
      captured.find((m) => m && m.method === "ui/notifications/tool-input"),
    ).toBeUndefined();

    // The adapter forwards the prop content explicitly (external messages case).
    session.syncContent(
      makeContent({
        toolInput: { via: "props" },
        result: { content: [{ type: "text", text: "props result" }] },
      }),
    );
    await tick(20);

    const input = captured.find(
      (m) => m && m.method === "ui/notifications/tool-input",
    );
    const result = captured.find(
      (m) => m && m.method === "ui/notifications/tool-result",
    );
    expect(input?.params?.arguments).toEqual({ via: "props" });
    expect(result?.params?.content?.[0]?.text).toBe("props result");
  });
});

// Use the real AG-UI event pipeline: activity callbacks receive the existing
// message BEFORE the snapshot/delta is applied. A mock that passes the updated
// message directly to those callbacks hides stale or missing widget updates.
describe("bindMcpApp real AG-UI activity updates", () => {
  it.each(["ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA", "MESSAGES_SNAPSHOT"])(
    "forwards the updated tool result after %s",
    async (eventType) => {
      const { HttpAgent } = await import("@ag-ui/client");
      const { MCPAppsActivityContentSchema } =
        await import("../content-schema");
      const initialContent = makeContent({
        result: { content: [{ type: "text", text: "initial result" }] },
      });
      const updatedContent = makeContent({
        result: { content: [{ type: "text", text: "updated result" }] },
      });
      const message = {
        id: "activity-under-test",
        role: "activity" as const,
        activityType: "mcp-apps",
        content: initialContent,
      };
      const updateEvent =
        eventType === "ACTIVITY_SNAPSHOT"
          ? {
              type: eventType,
              messageId: message.id,
              activityType: message.activityType,
              content: updatedContent,
            }
          : eventType === "ACTIVITY_DELTA"
            ? {
                type: eventType,
                messageId: message.id,
                activityType: message.activityType,
                patch: [
                  {
                    op: "replace",
                    path: "/result/content/0/text",
                    value: "updated result",
                  },
                ],
              }
            : {
                type: eventType,
                messages: [{ ...message, content: updatedContent }],
              };
      const events = [
        { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
        updateEvent,
        { type: "RUN_FINISHED", threadId: "test-thread", runId: "test-run" },
      ];
      const agent = new HttpAgent({
        url: "https://example.test/agent",
        threadId: "test-thread",
        initialMessages: [message],
        // Only the network boundary is mocked; parsing, event application,
        // subscriptions, and message state use the real HttpAgent.
        fetch: async () =>
          new Response(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      });
      const runAgent = agent.runAgent.bind(agent);
      vi.spyOn(agent, "runAgent").mockImplementation(async (params) => {
        // Resource loading must not consume the activity stream under test.
        if (params?.forwardedProps?.__proxiedMCPRequest) {
          return {
            result: {
              contents: [
                {
                  uri: initialContent.resourceUri,
                  text: "<html>Widget</html>",
                },
              ],
            },
            newMessages: [],
          };
        }
        return runAgent(params);
      });
      const getContent = () => {
        const current = agent.messages.find((item) => item.id === message.id);
        if (current?.role !== "activity") {
          throw new Error("Expected the activity message to exist");
        }
        return MCPAppsActivityContentSchema.parse(current.content);
      };
      const iframe = mount();
      sessions.push(
        bindMcpApp({
          iframe,
          getAgent: () => agent,
          getContent,
          messageId: message.id,
          host: {
            runAgent: async () => ({ result: undefined, newMessages: [] }),
          },
        }),
      );
      await vi.waitFor(() => {
        expect(iframe.srcdoc).toContain("sandbox-proxy-ready");
      });
      const captured = captureOutgoing(iframe);
      fromIframe(iframe, {
        jsonrpc: "2.0",
        id: "initialize-under-test",
        method: "ui/initialize",
        params: {
          appInfo: { name: "test-widget", version: "1.0.0" },
          appCapabilities: {},
          protocolVersion: "2026-01-26",
        },
      });
      await vi.waitFor(() => {
        expect(
          captured.find((item) => item.id === "initialize-under-test")?.result,
        ).toBeDefined();
      });
      fromIframe(iframe, {
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
      });
      const toolResults = () =>
        captured.filter(
          (item) => item.method === "ui/notifications/tool-result",
        );
      await vi.waitFor(() => {
        expect(toolResults().at(-1)?.params?.content?.[0]?.text).toBe(
          "initial result",
        );
      });
      captured.length = 0;

      await agent.runAgent({ runId: "test-run" });

      // First establish that AG-UI actually applied the update. The regression
      // is specifically in forwarding that updated state to the initialized app.
      expect(getContent().result).toEqual(updatedContent.result);
      await vi.waitFor(() => {
        expect(toolResults().at(-1)?.params?.content?.[0]?.text).toBe(
          "updated result",
        );
      });
    },
  );

  it("uses the applied activity, not a stale getContent, when the update precedes initialize", async () => {
    const { HttpAgent } = await import("@ag-ui/client");
    const { MCPAppsActivityContentSchema } = await import("../content-schema");
    const initialContent = makeContent({
      result: { content: [{ type: "text", text: "initial result" }] },
    });
    const updatedContent = makeContent({
      result: { content: [{ type: "text", text: "updated result" }] },
    });
    const message = {
      id: "activity-pre-init",
      role: "activity" as const,
      activityType: "mcp-apps",
      content: initialContent,
    };
    const events = [
      { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
      {
        type: "ACTIVITY_SNAPSHOT",
        messageId: message.id,
        activityType: message.activityType,
        content: updatedContent,
      },
      { type: "RUN_FINISHED", threadId: "test-thread", runId: "test-run" },
    ];
    const agent = new HttpAgent({
      url: "https://example.test/agent",
      threadId: "test-thread",
      initialMessages: [message],
      fetch: async () =>
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    const runAgent = agent.runAgent.bind(agent);
    vi.spyOn(agent, "runAgent").mockImplementation(async (params) => {
      if (params?.forwardedProps?.__proxiedMCPRequest) {
        return {
          result: {
            contents: [
              { uri: initialContent.resourceUri, text: "<html>Widget</html>" },
            ],
          },
          newMessages: [],
        };
      }
      return runAgent(params);
    });
    // getContent is intentionally STALE (always the initial content): the fix
    // must read the CURRENT activity from agent.messages at initialize, not this.
    const getContent = () => MCPAppsActivityContentSchema.parse(initialContent);
    const iframe = mount();
    sessions.push(
      bindMcpApp({
        iframe,
        getAgent: () => agent,
        getContent,
        messageId: message.id,
        host: {
          runAgent: async () => ({ result: undefined, newMessages: [] }),
        },
      }),
    );
    await vi.waitFor(() => {
      expect(iframe.srcdoc).toContain("sandbox-proxy-ready");
    });
    const captured = captureOutgoing(iframe);

    // Apply the update BEFORE the widget initializes.
    await agent.runAgent({ runId: "test-run" });
    expect(
      agent.messages.find((item) => item.id === message.id)?.content,
    ).toMatchObject({ result: updatedContent.result });

    // Initialize the widget only now.
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "init-pre",
      method: "ui/initialize",
      params: {
        appInfo: { name: "test-widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      },
    });
    await vi.waitFor(() => {
      expect(
        captured.find((item) => item.id === "init-pre")?.result,
      ).toBeDefined();
    });
    fromIframe(iframe, {
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    });

    const toolResults = () =>
      captured.filter((item) => item.method === "ui/notifications/tool-result");
    // The widget receives the CURRENT (updated) result, never the stale initial.
    await vi.waitFor(() => {
      expect(toolResults().at(-1)?.params?.content?.[0]?.text).toBe(
        "updated result",
      );
    });
    expect(
      toolResults().some(
        (item) => item.params?.content?.[0]?.text === "initial result",
      ),
    ).toBe(false);
  });
});
