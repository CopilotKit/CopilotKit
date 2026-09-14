import { describe, expect, it } from "vitest";
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
