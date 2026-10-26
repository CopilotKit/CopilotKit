import { describe, expect, it, vi } from "vitest";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/ext-apps";
import { buildSandboxHTML } from "../sandbox";
import {
  MCP_OPEN_LINK_BLOCKED_SCHEMES,
  MCPAppsActivityType,
} from "../constants";
// MCP_APPS_PROTOCOL_VERSION lives on the bridge side (session) so the bridge-free
// `./constants` / `./activity` entry never pulls the ext-apps bundle.
import { MCP_APPS_PROTOCOL_VERSION } from "../session";
import { MCPAppsActivityContentSchema } from "../content-schema";

describe("buildSandboxHTML", () => {
  it("produces a sandbox proxy document that announces sandbox-proxy-ready", () => {
    const html = buildSandboxHTML();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("ui/notifications/sandbox-proxy-ready");
    expect(html).toContain("Content-Security-Policy");
    // relays the widget HTML on sandbox-resource-ready
    expect(html).toContain("ui/notifications/sandbox-resource-ready");
  });

  it("appends extra CSP domains to script-src and frame-src", () => {
    const html = buildSandboxHTML(["https://example.com"]);
    expect(html).toContain("https://example.com");
  });

  it("keeps CSP host sources the server declares", () => {
    const domains = [
      "https://cdn.example.com",
      "*.example.org",
      "https://assets.example.net:8443/static",
      "wss://live.example.com",
    ];
    const html = buildSandboxHTML(domains);
    for (const domain of domains) expect(html).toContain(` ${domain}`);
  });

  it("drops server-supplied domains that would break out of the CSP", () => {
    const html = buildSandboxHTML([
      'https://cdn.example.com" /><b id="injected">x</b><meta x="',
      "https://a.example.com; script-src *",
      "https://ok.example.com",
    ]);
    expect(html).not.toContain("injected");
    expect(html).not.toContain("script-src *");
    expect(
      html.match(/<meta http-equiv="Content-Security-Policy"/g),
    ).toHaveLength(1);
    expect(html).toContain(" https://ok.example.com");
  });

  it("defaults the widget frame to an opaque origin", () => {
    expect(buildSandboxHTML()).not.toContain("allow-same-origin");
  });

  describe("relay", () => {
    /**
     * Run the proxy's own script against stub window/document objects, so the
     * relay rules are tested as shipped rather than by string matching.
     */
    function bootProxy() {
      const script = /<script>([\s\S]*)<\/script>/.exec(buildSandboxHTML())![1];
      const parent = { postMessage: vi.fn() };
      const inner = {
        style: {},
        setAttribute: vi.fn(),
        contentWindow: { postMessage: vi.fn() },
      };
      let onMessage!: (event: { source: unknown; data: unknown }) => void;
      const win = {
        parent,
        top: parent,
        addEventListener: (_: string, fn: typeof onMessage) => {
          onMessage = fn;
        },
      };
      const doc = {
        createElement: () => inner,
        body: { appendChild: () => {} },
      };
      new Function("window", "document", script)({ ...win, self: win }, doc);
      parent.postMessage.mockClear(); // drop the proxy's own ready notice
      const fromWidget = (data: unknown) =>
        onMessage({ source: inner.contentWindow, data });
      return { parent, inner, onMessage, fromWidget };
    }

    it("relays widget messages to the host", () => {
      const { parent, fromWidget } = bootProxy();
      const msg = { jsonrpc: "2.0", id: 1, method: "ui/initialize" };
      fromWidget(msg);
      expect(parent.postMessage).toHaveBeenCalledWith(msg, "*");
    });

    it("drops sandbox-* notifications a widget tries to forge", () => {
      const { parent, fromWidget } = bootProxy();
      fromWidget({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-proxy-ready",
        params: {},
      });
      fromWidget({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: { html: "<p>forged</p>" },
      });
      expect(parent.postMessage).not.toHaveBeenCalled();
    });

    it("applies the sandbox flags the host sends with the widget HTML", () => {
      const { inner, onMessage, parent } = bootProxy();
      onMessage({
        source: parent,
        data: {
          method: "ui/notifications/sandbox-resource-ready",
          params: { html: "<p>w</p>", sandbox: "allow-scripts" },
        },
      });
      expect(inner.setAttribute).toHaveBeenLastCalledWith(
        "sandbox",
        "allow-scripts",
      );
    });
  });
});

describe("constants", () => {
  it("exposes the mcp-apps activity type", () => {
    expect(MCPAppsActivityType).toBe("mcp-apps");
  });

  it("sources the protocol version from ext-apps (no hand-maintained literal)", () => {
    // MCP_APPS_PROTOCOL_VERSION is a re-export of the bridge's own
    // LATEST_PROTOCOL_VERSION, so it can never drift from the spec version.
    expect(MCP_APPS_PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("negotiates the expected current protocol version (2026-01-26 canary)", () => {
    // Canary: if ext-apps bumps the version, this fails so we review the change.
    expect(MCP_APPS_PROTOCOL_VERSION).toBe("2026-01-26");
  });

  it("blocks script/HTML-executing schemes for ui/open-link", () => {
    for (const scheme of [
      "javascript:",
      "data:",
      "vbscript:",
      "blob:",
      "file:",
    ]) {
      expect(MCP_OPEN_LINK_BLOCKED_SCHEMES.has(scheme)).toBe(true);
    }
    expect(MCP_OPEN_LINK_BLOCKED_SCHEMES.has("https:")).toBe(false);
  });
});

describe("content schema", () => {
  it("validates a well-formed activity content", () => {
    const parsed = MCPAppsActivityContentSchema.safeParse({
      result: { content: [{ type: "text", text: "ok" }], isError: false },
      resourceUri: "ui://server/dashboard",
      serverHash: "abc123",
      toolInput: { q: "hi" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects content missing resourceUri", () => {
    const parsed = MCPAppsActivityContentSchema.safeParse({
      result: {},
      serverHash: "abc123",
    });
    expect(parsed.success).toBe(false);
  });
});
