import { describe, expect, it, vi } from "vitest";
import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type { McpAppToolPolicy } from "../handlers/shared/mcp-apps-tool-policy";
import {
  createMcpAppsMiddleware,
  enforceMcpAppsToolPolicy,
  isMcpAppToolAllowed,
  mcpAppsServerPolicyKey,
} from "../handlers/shared/mcp-apps-tool-policy";

const server: MCPClientConfig = {
  type: "http",
  url: "https://mcp.example.com/mcp",
  serverId: "crm",
};

function discovered(names: string[]) {
  return names.map((name) => ({
    tool: { name },
    serverConfig: server,
    resourceUri: `ui://${name}`,
  }));
}

describe("isMcpAppToolAllowed", () => {
  it("allows every name when no list is set", () => {
    expect(isMcpAppToolAllowed("generate_qr", {})).toBe(true);
  });

  it("keeps only includeTools names", () => {
    const policy = { includeTools: ["generate_qr"] };
    expect(isMcpAppToolAllowed("generate_qr", policy)).toBe(true);
    expect(isMcpAppToolAllowed("admin_dashboard", policy)).toBe(false);
  });

  it("treats an empty include list as no tools", () => {
    expect(isMcpAppToolAllowed("generate_qr", { includeTools: [] })).toBe(
      false,
    );
  });

  it("applies excludeTools after includeTools", () => {
    const policy: McpAppToolPolicy = {
      includeTools: ["generate_qr", "admin_dashboard"],
      excludeTools: ["admin_dashboard"],
    };
    expect(isMcpAppToolAllowed("generate_qr", policy)).toBe(true);
    expect(isMcpAppToolAllowed("admin_dashboard", policy)).toBe(false);
    expect(isMcpAppToolAllowed("other", policy)).toBe(false);
  });

  it("lets excludeTools alone remove those names", () => {
    const policy = { excludeTools: ["admin_dashboard"] };
    expect(isMcpAppToolAllowed("admin_dashboard", policy)).toBe(false);
    expect(isMcpAppToolAllowed("generate_qr", policy)).toBe(true);
  });

  it("treats an empty exclude list as no denylist", () => {
    expect(isMcpAppToolAllowed("generate_qr", { excludeTools: [] })).toBe(true);
  });
});

describe("enforceMcpAppsToolPolicy", () => {
  it("filters discovery and blocks proxied and direct calls for hidden tools", async () => {
    const fetchToolsFromServer = vi.fn(async (_server: MCPClientConfig) =>
      discovered(["generate_qr", "admin_dashboard"]),
    );
    const executeMCPRequest = vi.fn(
      async (
        _server: MCPClientConfig,
        _method: string,
        _params?: Record<string, unknown>,
      ) => ({ ok: true }),
    );
    const executeToolCall = vi.fn(
      async (
        _server: MCPClientConfig,
        _name: string,
        _args: Record<string, unknown>,
      ) => ({ ok: true }),
    );
    const middleware = {
      fetchToolsFromServer,
      executeMCPRequest,
      executeToolCall,
    };
    const policies = new Map<string, McpAppToolPolicy>([
      [
        mcpAppsServerPolicyKey(server),
        {
          includeTools: ["generate_qr", "admin_dashboard"],
          excludeTools: ["admin_dashboard"],
        },
      ],
    ]);

    enforceMcpAppsToolPolicy(middleware, policies);

    const tools = await middleware.fetchToolsFromServer({
      ...server,
      headers: { Authorization: "Bearer token" },
    });
    expect(tools.map((tool) => tool.tool.name)).toEqual(["generate_qr"]);

    await expect(
      middleware.executeMCPRequest(server, "tools/call", {
        name: "admin_dashboard",
      }),
    ).rejects.toThrow(/MCP tool is not allowed: admin_dashboard/);
    expect(executeMCPRequest).not.toHaveBeenCalled();

    await middleware.executeMCPRequest(server, "resources/read", {
      uri: "ui://admin",
    });
    expect(executeMCPRequest).toHaveBeenCalledOnce();

    await expect(
      middleware.executeToolCall(server, "admin_dashboard", {}),
    ).rejects.toThrow(/not allowed/);
    expect(executeToolCall).not.toHaveBeenCalled();

    await middleware.executeToolCall(server, "generate_qr", {});
    expect(executeToolCall).toHaveBeenCalledOnce();
  });

  it("leaves a server without a policy unfiltered", async () => {
    const other: MCPClientConfig = {
      type: "http",
      url: "https://mcp.example.com/other",
      serverId: "other",
    };
    const fetchToolsFromServer = vi.fn(async (_server: MCPClientConfig) =>
      discovered(["generate_qr", "admin_dashboard"]),
    );
    const executeMCPRequest = vi.fn(
      async (
        _server: MCPClientConfig,
        _method: string,
        _params?: Record<string, unknown>,
      ) => ({ ok: true }),
    );
    const middleware = { fetchToolsFromServer, executeMCPRequest };

    enforceMcpAppsToolPolicy(
      middleware,
      new Map([
        [mcpAppsServerPolicyKey(server), { includeTools: ["generate_qr"] }],
      ]),
    );

    const tools = await middleware.fetchToolsFromServer(other);
    expect(tools).toHaveLength(2);
    await middleware.executeMCPRequest(other, "tools/call", {
      name: "admin_dashboard",
    });
    expect(executeMCPRequest).toHaveBeenCalledOnce();
  });

  it("drops a discovered entry that has no tool name", async () => {
    const fetchToolsFromServer = vi.fn(async (_server: MCPClientConfig) => [
      { tool: { name: "generate_qr" } },
      { tool: {} },
    ]);
    const executeMCPRequest = vi.fn(
      async (
        _server: MCPClientConfig,
        _method: string,
        _params?: Record<string, unknown>,
      ) => ({ ok: true }),
    );
    const middleware = { fetchToolsFromServer, executeMCPRequest };
    enforceMcpAppsToolPolicy(
      middleware,
      new Map([[mcpAppsServerPolicyKey(server), { includeTools: [] }]]),
    );

    await expect(middleware.fetchToolsFromServer(server)).resolves.toEqual([]);
  });

  it("rejects a tools/call that omits the tool name", async () => {
    const executeMCPRequest = vi.fn(
      async (
        _server: MCPClientConfig,
        _method: string,
        _params?: Record<string, unknown>,
      ) => ({ ok: true }),
    );
    const middleware = {
      fetchToolsFromServer: vi.fn(async (_server: MCPClientConfig) => []),
      executeMCPRequest,
    };
    enforceMcpAppsToolPolicy(
      middleware,
      new Map([[mcpAppsServerPolicyKey(server), { excludeTools: [] }]]),
    );

    await expect(
      middleware.executeMCPRequest(server, "tools/call", {}),
    ).rejects.toThrow(/MCP tool is not allowed$/);
    expect(executeMCPRequest).not.toHaveBeenCalled();
  });

  it("refuses to attach a policy the middleware build cannot enforce", () => {
    expect(() =>
      enforceMcpAppsToolPolicy(
        {},
        new Map([["key", { includeTools: ["generate_qr"] }]]),
      ),
    ).toThrow(/refused to attach the server/);
  });

  it("does nothing when no server has a policy", () => {
    expect(() => enforceMcpAppsToolPolicy({}, new Map())).not.toThrow();
  });
});

describe("createMcpAppsMiddleware", () => {
  it("strips tool lists before constructing the middleware", () => {
    const middleware = createMcpAppsMiddleware({
      mcpServers: [
        {
          ...server,
          includeTools: ["generate_qr"],
          excludeTools: ["admin_dashboard"],
        },
      ],
      discoveryFailureMode: "throw",
    });

    expect(middleware).toBeInstanceOf(MCPAppsMiddleware);
    const config = (
      middleware as unknown as {
        config: {
          mcpServers: Record<string, unknown>[];
          discoveryFailureMode?: string;
        };
      }
    ).config;
    expect(config.discoveryFailureMode).toBe("throw");
    expect(config.mcpServers).toEqual([server]);
  });
});
