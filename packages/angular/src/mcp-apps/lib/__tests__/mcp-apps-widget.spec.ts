import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPAppsSnapshotContent } from "../mcp-apps-content";
import { CopilotMCPAppsWidget } from "../mcp-apps-widget";
import {
  CopilotMCPAppsActivityRenderer,
  mcpAppsActivityRendererConfig,
} from "../mcp-apps-activity-renderer";
import { provideMCPApps } from "../provide-mcp-apps";

const mocks = vi.hoisted(() => ({
  clientCtor: vi.fn(),
  clientConnect: vi.fn(async () => undefined),
  clientClose: vi.fn(async () => undefined),
  readResource: vi.fn(),
  transportCtor: vi.fn(),
  bridgeCtor: vi.fn(),
  bridgeConnect: vi.fn(async () => undefined),
  sendToolInput: vi.fn(),
  sendToolResult: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class Client {
    connect = mocks.clientConnect;
    readResource = mocks.readResource;
    close = mocks.clientClose;

    constructor(info: unknown) {
      mocks.clientCtor(info);
    }
  }
  return { Client };
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class StreamableHTTPClientTransport {
    constructor(url: URL) {
      mocks.transportCtor(url);
    }
  }
  return { StreamableHTTPClientTransport };
});

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => {
  class AppBridge {
    onopenlink: unknown;
    onloggingmessage: unknown;
    onsizechange: unknown;
    onrequestdisplaymode: unknown;
    connect = mocks.bridgeConnect;
    sendToolInput = mocks.sendToolInput;
    sendToolResult = mocks.sendToolResult;
    teardownResource = vi.fn(async () => ({}));
    close = vi.fn(async () => undefined);

    constructor(...args: unknown[]) {
      mocks.bridgeCtor(...args);
    }

    set oninitialized(callback: (() => void) | undefined) {
      callback?.();
    }
  }
  class PostMessageTransport {}
  return { AppBridge, PostMessageTransport };
});

const snapshot: MCPAppsSnapshotContent = {
  serverId: "demo",
  resourceUri: "ui://demo/widget.html",
  result: { content: [{ type: "text", text: "done" }] },
  toolInput: { city: "Paris" },
};

function configureTestingModule() {
  TestBed.configureTestingModule({
    providers: [
      provideMCPApps({
        servers: {
          demo: "http://localhost:3999/mcp",
          dynamic: () => "http://localhost:4999/mcp",
        },
        hostInfo: { name: "Test Host", version: "1.0.0" },
      }),
    ],
  });
}

async function settle(fixture: {
  whenStable: () => Promise<unknown>;
  detectChanges: () => void;
}) {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 10));
  fixture.detectChanges();
}

describe("CopilotMCPAppsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readResource.mockResolvedValue({
      contents: [{ uri: "ui://demo/widget.html", text: "<h1>MCP App</h1>" }],
    });
  });

  it("loads the ui resource and boots the app bridge", async () => {
    configureTestingModule();
    const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
    fixture.componentRef.setInput("data", snapshot);

    await settle(fixture);

    const frame =
      fixture.nativeElement.querySelector<HTMLIFrameElement>("iframe");
    expect(mocks.transportCtor).toHaveBeenCalledWith(
      new URL("http://localhost:3999/mcp"),
    );
    expect(mocks.clientConnect).toHaveBeenCalledTimes(1);
    expect(mocks.readResource).toHaveBeenCalledWith({
      uri: "ui://demo/widget.html",
    });
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame?.getAttribute("srcdoc")).toContain("MCP App");
    expect(mocks.sendToolInput).toHaveBeenCalledWith({
      arguments: snapshot.toolInput,
    });
    expect(mocks.sendToolResult).toHaveBeenCalledWith(snapshot.result);
    expect(fixture.nativeElement.textContent).not.toContain("No MCP server");
  });

  it("announces the configured host identity to server and bridge", async () => {
    configureTestingModule();
    const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
    fixture.componentRef.setInput("data", snapshot);

    await settle(fixture);

    expect(mocks.clientCtor).toHaveBeenCalledWith({
      name: "Test Host",
      version: "1.0.0",
    });
    expect(mocks.bridgeCtor.mock.calls[0][1]).toEqual({
      name: "Test Host",
      version: "1.0.0",
    });
  });

  it("resolves function-valued server urls at connect time", async () => {
    configureTestingModule();
    const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
    fixture.componentRef.setInput("data", { ...snapshot, serverId: "dynamic" });

    await settle(fixture);

    expect(mocks.transportCtor).toHaveBeenCalledWith(
      new URL("http://localhost:4999/mcp"),
    );
  });

  it("shows an error when no server url is configured for the snapshot", async () => {
    configureTestingModule();
    const fixture = TestBed.createComponent(CopilotMCPAppsWidget);
    fixture.componentRef.setInput("data", { ...snapshot, serverId: "unknown" });

    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain(
      'No MCP server URL configured for server "unknown".',
    );
    const frame =
      fixture.nativeElement.querySelector<HTMLIFrameElement>("iframe");
    expect(frame?.hasAttribute("srcdoc")).toBe(false);
    expect(mocks.sendToolResult).not.toHaveBeenCalled();
  });
});

describe("CopilotMCPAppsActivityRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readResource.mockResolvedValue({
      contents: [{ uri: "ui://demo/widget.html", text: "<h1>MCP App</h1>" }],
    });
  });

  it("renders the widget for the activity message content", async () => {
    configureTestingModule();
    const fixture = TestBed.createComponent(CopilotMCPAppsActivityRenderer);
    fixture.componentRef.setInput("activityType", "mcp-apps");
    fixture.componentRef.setInput("content", snapshot);
    fixture.componentRef.setInput("message", {
      id: "activity-1",
      role: "activity",
      activityType: "mcp-apps",
      content: snapshot,
    });

    await settle(fixture);

    const widget = fixture.nativeElement.querySelector(
      "copilot-mcp-apps-widget",
    );
    expect(widget).not.toBeNull();
    expect(widget?.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
      "MCP App",
    );
  });

  it("is preconfigured for the mcp-apps activity type", () => {
    expect(mcpAppsActivityRendererConfig.activityType).toBe("mcp-apps");
    expect(mcpAppsActivityRendererConfig.component).toBe(
      CopilotMCPAppsActivityRenderer,
    );
  });
});
