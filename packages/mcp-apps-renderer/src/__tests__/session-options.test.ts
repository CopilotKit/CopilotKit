/**
 * Session configuration lifted from the Angular host (`MCP_APPS_CONFIG`) into
 * the shared core: host identity/capabilities/context, the two timeouts, and a
 * pluggable `ui/open-link` policy. Defaults keep React and Vue unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import {
  bindMcpApp,
  denyDangerousSchemes,
  MCP_APPS_SESSION_DEFAULTS,
} from "../session";
import type { McpAppSession } from "../session";

let sessions: McpAppSession[] = [];
let iframes: HTMLIFrameElement[] = [];
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function makeAgent() {
  return {
    threadId: "thread-1",
    isRunning: false,
    subscribe: () => ({ unsubscribe() {} }),
    addMessage() {},
    async runAgent() {
      return {
        result: {
          contents: [
            { uri: "ui://test/app", mimeType: "text/html", text: "<p>w</p>" },
          ],
        },
        newMessages: [],
      };
    },
  } as unknown as AbstractAgent;
}

function mount() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframes.push(iframe);
  return iframe;
}

function fromIframe(iframe: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source: iframe.contentWindow,
      origin: "",
    }),
  );
}

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

async function bindAndConnect(
  iframe: HTMLIFrameElement,
  opts: Partial<Parameters<typeof bindMcpApp>[0]> = {},
) {
  const session = bindMcpApp({
    iframe,
    getContent: () =>
      ({
        resourceUri: "ui://test/app",
        serverHash: "hash",
        result: { content: [] },
      }) as never,
    getAgent: () => makeAgent(),
    host: { runAgent: async () => ({ result: undefined, newMessages: [] }) },
    ...opts,
  });
  sessions.push(session);
  await tick();
  const captured = captureOutgoing(iframe);
  fromIframe(iframe, {
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
  });
  await tick(30);
  return captured;
}

afterEach(() => {
  sessions.forEach((s) => s.teardown());
  sessions = [];
  iframes.forEach((f) => f.remove());
  iframes = [];
  vi.restoreAllMocks();
});

describe("host identity and context options", () => {
  it("announces the configured hostInfo and hostContext at initialize", async () => {
    const iframe = mount();
    const captured = await bindAndConnect(iframe, {
      options: {
        hostInfo: { name: "Acme Host", version: "9.9.9" },
        hostContext: { theme: "dark", platform: "web", locale: "fr-FR" },
      },
    });

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "init",
      method: "ui/initialize",
      params: {
        appInfo: { name: "w", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      },
    });
    await tick(30);

    const response = captured.find((m) => m?.id === "init" && m.result);
    expect(response.result.hostInfo).toMatchObject({
      name: "Acme Host",
      version: "9.9.9",
    });
    expect(response.result.hostContext).toMatchObject({
      theme: "dark",
      locale: "fr-FR",
    });
  });

  it("keeps the shared defaults when no options are supplied", async () => {
    const iframe = mount();
    const captured = await bindAndConnect(iframe);

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "init-default",
      method: "ui/initialize",
      params: {
        appInfo: { name: "w", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: "2026-01-26",
      },
    });
    await tick(30);

    const response = captured.find((m) => m?.id === "init-default" && m.result);
    expect(response.result.hostInfo).toMatchObject(
      MCP_APPS_SESSION_DEFAULTS.hostInfo,
    );
    expect(response.result.hostContext).toMatchObject({
      theme: "light",
      platform: "web",
    });
  });
});

describe("sandbox initialization timeout", () => {
  it("reports an error when the sandbox proxy never reports ready", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const iframe = mount();
      sessions.push(
        bindMcpApp({
          iframe,
          getContent: () =>
            ({
              resourceUri: "ui://test/app",
              serverHash: "hash",
              result: { content: [] },
            }) as never,
          getAgent: () => makeAgent(),
          host: {
            runAgent: async () => ({ result: undefined, newMessages: [] }),
          },
          options: { initializationTimeoutMs: 5000 },
          hooks: { onError },
        }),
      );
      // Let the resource fetch + connect settle so the watchdog is armed.
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(6000);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/sandbox to initialize/i),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sandbox timeout is terminal", () => {
  it("stops serving the widget after the timeout instead of only reporting it", async () => {
    const onError = vi.fn();
    const agent = makeAgent();
    const runSpy = vi.spyOn(agent, "runAgent");
    const iframe = mount();
    sessions.push(
      bindMcpApp({
        iframe,
        getContent: () =>
          ({
            resourceUri: "ui://test/app",
            serverHash: "hash",
            result: { content: [] },
          }) as never,
        getAgent: () => agent,
        host: {
          runAgent: async () => ({ result: undefined, newMessages: [] }),
        },
        options: { initializationTimeoutMs: 40 },
        hooks: { onError },
      }),
    );
    // Let the resource fetch settle, then let the handshake window lapse.
    await tick(120);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/sandbox to initialize/i),
      }),
    );

    // The widget never handshaked, so a late tools/call from that iframe must
    // not reach the agent: the session owns its terminal state rather than
    // waiting for the adapter to unmount it.
    runSpy.mockClear();
    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "late-call",
      method: "tools/call",
      params: { name: "do_thing", arguments: {} },
    });
    await tick(60);
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe("open-link policies", () => {
  it("denyDangerousSchemes allows https and custom deep links, blocks script schemes", () => {
    expect(denyDangerousSchemes("https://example.com")).toBe(
      "https://example.com",
    );
    expect(denyDangerousSchemes("myapp://open/thing")).toBe(
      "myapp://open/thing",
    );
    // eslint-disable-next-line no-script-url
    expect(denyDangerousSchemes("javascript:alert(1)")).toBeUndefined();
    expect(denyDangerousSchemes("data:text/html,<p>x</p>")).toBeUndefined();
    expect(denyDangerousSchemes("not a url")).toBeUndefined();
  });

  it("refuses embedded credentials", () => {
    // Lifted from the Angular policy: a widget must not hand the browser a URL
    // carrying someone's credentials.
    expect(denyDangerousSchemes("https://user:pw@example.com")).toBeUndefined();
    expect(denyDangerousSchemes("https://user@example.com")).toBeUndefined();
  });

  it("resolves a relative link against the host document", () => {
    // Also from Angular: previously `new URL("/docs")` threw and the link was
    // silently refused for React and Vue.
    expect(denyDangerousSchemes("/docs")).toContain("/docs");
  });

  it("uses the supplied policy for ui/open-link", async () => {
    // A host CAN still override; nothing in CopilotKit does.
    const iframe = mount();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const captured = await bindAndConnect(iframe, {
      openLinkPolicy: () => undefined,
    });

    fromIframe(iframe, {
      jsonrpc: "2.0",
      id: "deep",
      method: "ui/open-link",
      params: { url: "myapp://open/thing" },
    });
    await tick(30);

    // Refused by the strict policy, where the default would have allowed it.
    expect(openSpy).not.toHaveBeenCalled();
    const response = captured.find((m) => m?.id === "deep" && m.result);
    expect(response.result).toMatchObject({ isError: true });
  });
});
