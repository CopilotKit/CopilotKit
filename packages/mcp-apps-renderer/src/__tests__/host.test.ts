import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { McpAppHost } from "../host";
import type { McpAppsRendererModule } from "../host";
import type { BindMcpAppOptions, McpAppSession } from "../session";
import type { MCPAppsActivityContent } from "../content-schema";
import type { ɵMcpFollowUpHost } from "../follow-up";

/**
 * A stand-in for the bridge: records each bind and lets the test drive the
 * session hooks. The real session has its own e2e tests.
 */
function fakeRenderer() {
  const binds: BindMcpAppOptions[] = [];
  const sessions: {
    teardown: ReturnType<typeof vi.fn>;
    syncContent: ReturnType<typeof vi.fn>;
  }[] = [];
  const renderer: McpAppsRendererModule = {
    bindMcpApp(options) {
      binds.push(options);
      const session = {
        sendToolInput: vi.fn(),
        sendToolResult: vi.fn(),
        syncContent: vi.fn(),
        teardown: vi.fn(),
      } satisfies McpAppSession;
      sessions.push(session);
      return session;
    },
  };
  return { renderer, binds, sessions };
}

const content = (resourceUri = "ui://app"): MCPAppsActivityContent => ({
  resourceUri,
  serverHash: "hash",
  result: { content: [] },
});

const coreHost: ɵMcpFollowUpHost = {
  runAgent: async () => ({ result: undefined, newMessages: [] }),
};

async function bound(options: { scopeToWidget?: boolean } = {}) {
  const renderer = fakeRenderer();
  const app = new McpAppHost({
    host: coreHost,
    importRenderer: async () => renderer.renderer,
    iframeAttributes: { "data-testid": "mcp-app-iframe" },
    ...options,
  });
  const container = document.createElement("div");
  app.setContent(content());
  app.setAgent(new HttpAgent({ url: "http://localhost" }));
  app.setContainer(container);
  await vi.waitFor(() => expect(renderer.binds).toHaveLength(1));
  return { app, renderer, container, hooks: renderer.binds[0]!.hooks! };
}

describe("McpAppHost", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates the iframe in the container and binds a session to it", async () => {
    const { container, renderer } = await bound();
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("data-testid")).toBe("mcp-app-iframe");
    expect(renderer.binds[0]!.iframe).toBe(iframe);
    expect(renderer.sessions[0]!.syncContent).toHaveBeenCalledOnce();
  });

  it("stops loading and reads prefersBorder when the resource arrives", async () => {
    const { app, hooks } = await bound();
    expect(app.getState().loading).toBe(true);
    hooks.onResource!({
      uri: "ui://app",
      _meta: { ui: { prefersBorder: true } },
    });
    expect(app.getState()).toMatchObject({
      loading: false,
      prefersBorder: true,
    });
  });

  it("sizes the iframe, capping the height at 5000px", async () => {
    const { app, hooks, container } = await bound();
    hooks.onSizeChanged!({ width: 320, height: 9000.2 });
    const iframe = container.querySelector("iframe")!;
    expect(iframe.style.height).toBe("5000px");
    expect(iframe.style.minWidth).toBe("min(320px, 100%)");
    expect(app.getState().size).toEqual({ width: 320, height: 5000 });
  });

  it("ignores a size that is not a positive number", async () => {
    const { hooks, container } = await bound();
    hooks.onSizeChanged!({ height: -1 });
    expect(container.querySelector("iframe")!.style.height).toBe("100px");
  });

  it("shows and clears content errors", async () => {
    const { app, hooks } = await bound();
    hooks.onContentError!(new Error("bad content"));
    expect(app.getState().contentError).toBe("bad content");
    hooks.onContentError!(null);
    expect(app.getState().contentError).toBeNull();
  });

  it("feeds new tool results to the session without rebinding", async () => {
    const { app, renderer } = await bound();
    app.setContent({
      ...content(),
      result: { content: [{ type: "text", text: "x" }] },
    });
    expect(renderer.binds).toHaveLength(1);
    expect(renderer.sessions[0]!.syncContent).toHaveBeenCalledTimes(2);
  });

  it("binds again with a new iframe when the widget identity changes", async () => {
    const { app, renderer, container } = await bound();
    app.setContent(content("ui://other"));
    await vi.waitFor(() => expect(renderer.binds).toHaveLength(2));
    expect(renderer.sessions[0]!.teardown).toHaveBeenCalled();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("reports a missing agent", () => {
    const app = new McpAppHost({
      host: coreHost,
      importRenderer: async () => fakeRenderer().renderer,
    });
    app.setContent(content());
    app.setContainer(document.createElement("div"));
    expect(app.getState()).toMatchObject({
      loading: false,
      error: "No agent available to fetch resource",
    });
  });

  it("names the package to install when the bridge cannot load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = new McpAppHost({
      host: coreHost,
      importRenderer: () => Promise.reject(new Error("Cannot find module")),
    });
    app.setContent(content());
    app.setAgent(new HttpAgent({ url: "http://localhost" }));
    app.setContainer(document.createElement("div"));
    await vi.waitFor(() =>
      expect(app.getState().error).toContain("@copilotkit/mcp-apps-renderer"),
    );
  });

  it("scopes the session to the widget when asked", async () => {
    const { renderer } = await bound({ scopeToWidget: true });
    expect(renderer.binds[0]).toMatchObject({
      cancelFollowUpsOnTeardown: true,
      requireExactResourceUri: true,
      cancelRunningWaitOnTeardown: true,
    });
  });

  it("blanks a widget-scoped app when a follow-up fails", async () => {
    const { app, renderer, hooks, container } = await bound({
      scopeToWidget: true,
    });
    const iframe = container.querySelector("iframe")!;
    iframe.setAttribute("srcdoc", "<p>app</p>");
    hooks.onFollowUpError!(new Error("follow-up failed"));
    expect(app.getState().error).toBe("follow-up failed");
    expect(iframe.hasAttribute("srcdoc")).toBe(false);
    expect(renderer.sessions[0]!.teardown).toHaveBeenCalled();
  });

  it("removes the iframe and tears the session down on destroy", async () => {
    const { app, renderer, container } = await bound();
    app.destroy();
    expect(container.querySelector("iframe")).toBeNull();
    expect(renderer.sessions[0]!.teardown).toHaveBeenCalled();
  });
});
