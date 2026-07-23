import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import {
  CopilotKit,
  anyActivityContentSchema,
  provideCopilotKit,
} from "@copilotkit/angular";
import type { MCPAppsSnapshotContent } from "../mcp-apps-content";
import {
  CopilotMCPAppsActivityRenderer,
  mcpAppsActivityRendererConfig,
} from "../mcp-apps-activity-renderer";
import { CopilotMCPAppsWidget } from "../mcp-apps-widget";
import { provideMCPApps } from "../provide-mcp-apps";
import { expect, test, vi } from "vitest";

type AgentHarness = AbstractAgent & {
  addMessage: ReturnType<typeof vi.fn>;
  runAgent: ReturnType<typeof vi.fn>;
  finishRun(): void;
};

const snapshot: MCPAppsSnapshotContent = {
  serverHash: "server-hash",
  serverId: "demo",
  resourceUri: "ui://demo/widget.html",
  result: { content: [{ type: "text", text: "done" }] },
  toolInput: { city: "Paris" },
};

@Component({ template: "custom" })
class CustomMCPAppsRenderer extends CopilotMCPAppsActivityRenderer {}

function createAgent(resourceText = "<h1>MCP App</h1>"): AgentHarness {
  const subscribers: Array<{
    onRunFinalized?: () => void;
    onRunFailed?: () => void;
  }> = [];
  const agent = {
    threadId: "thread-1",
    isRunning: false,
    messages: [],
    addMessage: vi.fn(),
    subscribe: vi.fn(
      (subscriber: {
        onRunFinalized?: () => void;
        onRunFailed?: () => void;
      }) => {
        subscribers.push(subscriber);
        return {
          unsubscribe: () => {
            const index = subscribers.indexOf(subscriber);
            if (index >= 0) subscribers.splice(index, 1);
          },
        };
      },
    ),
    runAgent: vi.fn(
      async (parameters: {
        forwardedProps?: {
          __proxiedMCPRequest?: { method?: string };
        };
      }): Promise<RunAgentResult> => {
        const method = parameters.forwardedProps?.__proxiedMCPRequest?.method;
        if (method === "resources/read") {
          return {
            result: {
              contents: [
                {
                  uri: snapshot.resourceUri,
                  mimeType: "text/html",
                  text: resourceText,
                },
              ],
            },
            newMessages: [],
          };
        }
        return {
          result: { content: [{ type: "text", text: "tool response" }] },
          newMessages: [],
        };
      },
    ),
    finishRun() {
      this.isRunning = false;
      for (const subscriber of subscribers.slice()) {
        subscriber.onRunFinalized?.();
      }
    },
  };
  return agent as unknown as AgentHarness;
}

function configureTestingModule(
  runAgent = vi.fn(async () => ({ result: undefined, newMessages: [] })),
  idleTimeoutMs = 30_000,
  initializationTimeoutMs = 30_000,
): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideMCPApps({
        idleTimeoutMs,
        initializationTimeoutMs,
      }),
      {
        provide: CopilotKit,
        useValue: { core: { runAgent } },
      },
    ],
  });
}

async function settle(fixture: {
  whenStable: () => Promise<unknown>;
  detectChanges: () => void;
}): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function dispatchFrameMessage(
  frame: HTMLIFrameElement,
  data: unknown,
  source: MessageEventSource | null = frame.contentWindow,
): void {
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}

async function bootWidget(agent: AgentHarness): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<CopilotMCPAppsWidget>>;
  frame: HTMLIFrameElement;
  postMessage: ReturnType<typeof vi.spyOn>;
}> {
  const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
  fixture.componentRef.setInput("data", snapshot);
  fixture.componentRef.setInput("agent", agent);
  await settle(fixture);

  const frame = fixture.nativeElement.querySelector<HTMLIFrameElement>(
    "[data-testid='mcp-app-iframe']",
  );
  if (!frame?.contentWindow) throw new Error("MCP Apps iframe was not created");
  await waitFor(
    () => frame.srcdoc.includes("sandbox-proxy-ready"),
    "sandbox proxy was not installed",
  );

  const postMessage = vi.spyOn(frame.contentWindow, "postMessage");
  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
    params: {},
  });
  await settle(fixture);
  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    method: "ui/notifications/initialized",
    params: {},
  });
  await settle(fixture);

  return { fixture, frame, postMessage };
}

test("loads the resource through the selected agent and boots the sandbox", async () => {
  configureTestingModule();
  const agent = createAgent();
  const { fixture, frame, postMessage } = await bootWidget(agent);

  expect(agent.runAgent).toHaveBeenCalledWith({
    forwardedProps: {
      __proxiedMCPRequest: {
        serverHash: "server-hash",
        serverId: "demo",
        method: "resources/read",
        params: { uri: "ui://demo/widget.html" },
      },
    },
  });
  expect(frame.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms",
  );
  expect(frame.srcdoc).toContain("Content-Security-Policy");
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-resource-ready",
      params: { html: "<h1>MCP App</h1>" },
    }),
    "*",
  );
  expect(postMessage).toHaveBeenCalledWith(
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: snapshot.toolInput },
    },
    "*",
  );
  expect(postMessage).toHaveBeenCalledWith(
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: snapshot.result,
    },
    "*",
  );
  expect(fixture.nativeElement.querySelector("[role='status']")).toBeNull();
});

test("decodes UTF-8 resource blobs without corrupting text", async () => {
  configureTestingModule();
  const agent = createAgent();
  const html = "<h1>Héllo 👋</h1>";
  const bytes = new TextEncoder().encode(html);
  const blob = btoa(String.fromCharCode(...bytes));
  agent.runAgent.mockResolvedValueOnce({
    result: {
      contents: [
        {
          uri: snapshot.resourceUri,
          mimeType: "text/html",
          blob,
        },
      ],
    },
    newMessages: [],
  });

  const { postMessage } = await bootWidget(agent);

  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "ui/notifications/sandbox-resource-ready",
      params: expect.objectContaining({ html }),
    }),
    "*",
  );
});

test("preserves the sandbox across equivalent activity snapshot updates", async () => {
  configureTestingModule();
  const agent = createAgent();
  const { fixture, frame } = await bootWidget(agent);
  const initialSrcdoc = frame.srcdoc;

  fixture.componentRef.setInput("data", {
    ...snapshot,
    result: { content: [{ type: "text", text: "done" }] },
    toolInput: { city: "Paris" },
  });
  await settle(fixture);

  expect(agent.runAgent).toHaveBeenCalledTimes(1);
  expect(frame.srcdoc).toBe(initialSrcdoc);
});

test("accepts JSON-RPC only from the exact iframe window", async () => {
  configureTestingModule();
  const agent = createAgent();
  const { frame, postMessage } = await bootWidget(agent);
  postMessage.mockClear();

  dispatchFrameMessage(
    frame,
    { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} },
    window,
  );
  dispatchFrameMessage(frame, { id: 2, method: "ui/initialize", params: {} });
  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    id: 3,
    method: "ui/initialize",
    params: {},
  });

  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ jsonrpc: "2.0", id: 3 }),
    "*",
  );
  expect(frame.getAttribute("data-mcp-app-initialized")).toBe("true");
});

test("proxies tool calls through the selected agent", async () => {
  configureTestingModule();
  const agent = createAgent();
  const { frame, postMessage } = await bootWidget(agent);
  postMessage.mockClear();

  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    id: "tool-1",
    method: "tools/call",
    params: { name: "weather", arguments: { city: "Paris" } },
  });
  await waitFor(
    () => agent.runAgent.mock.calls.length === 2,
    "tool did not run",
  );
  await Promise.resolve();

  expect(agent.runAgent.mock.calls[1]?.[0]).toEqual({
    forwardedProps: {
      __proxiedMCPRequest: {
        serverHash: "server-hash",
        serverId: "demo",
        method: "tools/call",
        params: { name: "weather", arguments: { city: "Paris" } },
      },
    },
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ jsonrpc: "2.0", id: "tool-1" }),
    "*",
  );
});

test("acknowledges UI messages and runs same-thread follow-ups through core", async () => {
  const runFollowUp = vi.fn(async () => ({
    result: undefined,
    newMessages: [],
  }));
  configureTestingModule(runFollowUp);
  const agent = createAgent();
  const { frame, postMessage } = await bootWidget(agent);
  postMessage.mockClear();

  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    id: "message-1",
    method: "ui/message",
    params: {
      role: "user",
      content: [{ type: "text", text: "Book it" }],
      followUp: true,
    },
  });
  await waitFor(
    () => runFollowUp.mock.calls.length === 1,
    "follow-up did not run",
  );

  expect(agent.addMessage).toHaveBeenCalledWith(
    expect.objectContaining({ role: "user", content: "Book it" }),
  );
  expect(postMessage).toHaveBeenCalledWith(
    { jsonrpc: "2.0", id: "message-1", result: { isError: false } },
    "*",
  );
  expect(runFollowUp).toHaveBeenCalledWith({ agent });
});

test("drops a queued UI follow-up after its agent switches threads", async () => {
  const runFollowUp = vi.fn(async () => ({
    result: undefined,
    newMessages: [],
  }));
  configureTestingModule(runFollowUp);
  const agent = createAgent();
  const { frame } = await bootWidget(agent);
  agent.isRunning = true;

  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    id: "message-1",
    method: "ui/message",
    params: {
      role: "user",
      content: [{ type: "text", text: "Do not leak me" }],
      followUp: true,
    },
  });
  agent.threadId = "thread-2";
  agent.finishRun();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(runFollowUp).not.toHaveBeenCalled();
});

test("rejects unsafe open-link schemes without opening a window", async () => {
  configureTestingModule();
  const agent = createAgent();
  const { frame, postMessage } = await bootWidget(agent);
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  postMessage.mockClear();

  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    id: "unsafe-link",
    method: "ui/open-link",
    params: { url: "javascript:alert(document.cookie)" },
  });

  expect(open).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "unsafe-link",
      error: expect.objectContaining({ code: -32602 }),
    }),
    "*",
  );
  open.mockRestore();
});

test("matches the React SDK sandbox and resource CSP contract", async () => {
  configureTestingModule();
  const agent = createAgent();
  agent.runAgent.mockResolvedValueOnce({
    result: {
      contents: [
        {
          uri: snapshot.resourceUri,
          text: "<h1>MCP App</h1>",
          _meta: {
            ui: {
              csp: {
                resourceDomains: ["https://cdn.example.com"],
              },
            },
          },
        },
      ],
    },
    newMessages: [],
  });
  const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
  fixture.componentRef.setInput("data", snapshot);
  fixture.componentRef.setInput("agent", agent);
  await settle(fixture);
  const frame = fixture.nativeElement.querySelector<HTMLIFrameElement>(
    "[data-testid='mcp-app-iframe']",
  );
  if (!frame?.contentWindow) throw new Error("MCP Apps iframe was not created");
  await waitFor(() => Boolean(frame.srcdoc), "sandbox proxy was not installed");
  const postMessage = vi.spyOn(frame.contentWindow, "postMessage");
  dispatchFrameMessage(frame, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
    params: {},
  });
  await settle(fixture);

  const resourceReady = postMessage.mock.calls.find(
    ([message]) =>
      (message as { method?: string }).method ===
      "ui/notifications/sandbox-resource-ready",
  )?.[0];

  expect(frame.getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin allow-forms",
  );
  expect(frame.getAttribute("src")).toBeNull();
  expect(frame.srcdoc).toContain(
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:* https://cdn.example.com",
  );
  expect(frame.srcdoc).toContain(
    'inner.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms")',
  );
  expect(resourceReady).toEqual({
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-resource-ready",
    params: { html: "<h1>MCP App</h1>" },
  });
});

test("shows accessible loading and missing-resource errors", async () => {
  configureTestingModule();
  const agent = createAgent();
  agent.runAgent.mockResolvedValueOnce({
    result: { contents: [] },
    newMessages: [],
  });
  const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
  fixture.componentRef.setInput("data", snapshot);
  fixture.componentRef.setInput("agent", agent);

  fixture.detectChanges();
  expect(
    fixture.nativeElement.querySelector("[role='status']")?.textContent,
  ).toContain("Loading MCP App");
  await settle(fixture);
  await waitFor(
    () => Boolean(fixture.nativeElement.querySelector("[role='alert']")),
    "missing resource error was not shown",
  );

  expect(
    fixture.nativeElement.querySelector("[role='alert']")?.textContent,
  ).toContain("No matching MCP App resource");
});

test("shows an accessible error when the sandbox handshake times out", async () => {
  configureTestingModule(undefined, 30_000, 5);
  const agent = createAgent();
  const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
  fixture.componentRef.setInput("data", snapshot);
  fixture.componentRef.setInput("agent", agent);
  await settle(fixture);
  await new Promise((resolve) => setTimeout(resolve, 10));
  fixture.detectChanges();

  expect(
    fixture.nativeElement.querySelector("[role='alert']")?.textContent,
  ).toContain("Timed out waiting 5ms for the MCP App sandbox");
});

test("renders through the built-in activity config and passes the agent", async () => {
  configureTestingModule();
  const agent = createAgent();
  const fixture = TestBed.createComponent(CopilotMCPAppsActivityRenderer);
  fixture.componentRef.setInput("activityType", "mcp-apps");
  fixture.componentRef.setInput("content", snapshot);
  fixture.componentRef.setInput("message", {
    id: "activity-1",
    role: "activity",
    activityType: "mcp-apps",
    content: snapshot,
  });
  fixture.componentRef.setInput("agent", agent);
  await settle(fixture);

  expect(
    fixture.nativeElement.querySelector("copilot-mcp-apps-widget"),
  ).not.toBeNull();
  expect(mcpAppsActivityRendererConfig.activityType).toBe("mcp-apps");
  expect(mcpAppsActivityRendererConfig.component).toBe(
    CopilotMCPAppsActivityRenderer,
  );
});

test("provideMCPApps registers a lower-precedence built-in renderer", () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideCopilotKit({
        renderActivityMessages: [
          {
            activityType: "mcp-apps",
            content: anyActivityContentSchema,
            component: CustomMCPAppsRenderer,
          },
        ],
      }),
      provideMCPApps(),
    ],
  });

  const renderers = TestBed.inject(CopilotKit)
    .activityMessageRenderConfigs()
    .filter((renderer) => renderer.activityType === "mcp-apps");

  expect(renderers.map((renderer) => renderer.component)).toEqual([
    CustomMCPAppsRenderer,
    CopilotMCPAppsActivityRenderer,
  ]);
});
