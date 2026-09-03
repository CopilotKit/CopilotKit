import { describe, expect, it } from "vitest";
import { buildSandboxHTML } from "../sandbox";
import {
  MCP_APPS_PROTOCOL_VERSION,
  MCP_OPEN_LINK_BLOCKED_SCHEMES,
  MCPAppsActivityType,
} from "../constants";
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

  it("advertises the ext-apps protocol version (2026-01-26)", () => {
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
