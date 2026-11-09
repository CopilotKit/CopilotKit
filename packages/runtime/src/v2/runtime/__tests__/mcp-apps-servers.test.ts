import { describe, expect, it } from "vitest";
import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import type { McpAppsServerConfig } from "../core/runtime";
import { resolveMcpAppsServers } from "../handlers/shared/mcp-apps-servers";

type Assert<T extends true> = T;
type ExternalPolicyKeys = Extract<
  keyof MCPClientConfig,
  "includeTools" | "excludeTools"
>;
type ExternalMiddlewareHasNoPolicyFields = [ExternalPolicyKeys] extends [never]
  ? true
  : false;
type ExternalMiddlewarePolicyTripwire =
  Assert<ExternalMiddlewareHasNoPolicyFields>;

// The installed middleware still has no policy fields. The runtime applies
// includeTools / excludeTools itself. When this assignment fails, pass the
// lists through instead of filtering them again here.
void (undefined as unknown as ExternalMiddlewarePolicyTripwire);

const baseServer = {
  type: "sse" as const,
  url: "https://mcp.example.com/sse",
  headers: { Authorization: "Bearer token" },
  serverId: "weather",
  futureField: { retained: true },
};

function asServer(config: Record<string, unknown>): McpAppsServerConfig {
  return config as unknown as McpAppsServerConfig;
}

describe("resolveMcpAppsServers", () => {
  it.each([
    ["includeTools", null],
    ["includeTools", "get_weather"],
    ["includeTools", [1]],
    ["includeTools", [""]],
    ["includeTools", ["generate_qr", null]],
    ["excludeTools", null],
    ["excludeTools", "delete_account"],
    ["excludeTools", { name: "delete_account" }],
  ])("rejects a malformed %s value", (key, value) => {
    expect(() =>
      resolveMcpAppsServers(
        [asServer({ ...baseServer, [key]: value })],
        "default",
      ),
    ).toThrow(
      new RegExp(
        `${key} at server\\[0\\] \\(weather\\) must be an array of non-empty tool names`,
      ),
    );
  });

  it("names a server without serverId by its URL minus credentials", () => {
    // This message reaches the client, so the URL's userinfo and query stay out.
    const { serverId: _serverId, ...withoutId } = baseServer;
    let message = "";
    try {
      resolveMcpAppsServers(
        [
          asServer({
            ...withoutId,
            url: "https://user:pass@mcp.example.com/sse?token=secret-123",
            includeTools: "get_weather",
          }),
        ],
        "default",
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("server[0] (https://mcp.example.com/sse)");
    expect(message).not.toMatch(/secret-123|user:pass/);
  });

  it("reports every invalid policy before filtering by agent", () => {
    expect(() =>
      resolveMcpAppsServers(
        [
          asServer({
            ...baseServer,
            serverId: "other",
            agentId: "other",
            includeTools: null,
          }),
          asServer({
            ...baseServer,
            serverId: "current",
            agentId: "current",
            excludeTools: "delete_account",
          }),
        ],
        "current",
      ),
    ).toThrow(
      /includeTools at server\[0\] \(other\).*excludeTools at server\[1\] \(current\)/,
    );
  });

  it("keeps include and exclude lists and still strips only agentId", () => {
    const resolved = resolveMcpAppsServers(
      [
        asServer({
          ...baseServer,
          agentId: "default",
          includeTools: ["generate_qr"],
          excludeTools: [],
        }),
      ],
      "default",
    );

    expect(resolved).toEqual([
      {
        type: "sse",
        url: baseServer.url,
        headers: baseServer.headers,
        serverId: "weather",
        futureField: baseServer.futureField,
        includeTools: ["generate_qr"],
        excludeTools: [],
      },
    ]);
  });

  it("accepts an explicitly undefined policy value and forwards it unchanged", () => {
    const server = { ...baseServer, includeTools: undefined };

    expect(resolveMcpAppsServers([asServer(server)], "default")).toEqual([
      server,
    ]);
  });

  it("filters by agent, strips only agentId, and preserves order and fields", () => {
    const globalServer = { ...baseServer, serverId: "global" };
    const otherServer = {
      ...baseServer,
      serverId: "other",
      agentId: "other",
    };
    const matchingServer = {
      ...baseServer,
      serverId: "matching",
      agentId: "default",
    };

    const resolved = resolveMcpAppsServers(
      [asServer(globalServer), asServer(otherServer), asServer(matchingServer)],
      "default",
    );

    expect(resolved).toEqual([
      globalServer,
      {
        type: "sse",
        url: matchingServer.url,
        headers: matchingServer.headers,
        serverId: "matching",
        futureField: matchingServer.futureField,
      },
    ]);
    expect(Object.prototype.hasOwnProperty.call(resolved[0], "agentId")).toBe(
      false,
    );
  });

  it("returns no servers for empty and nonmatching configurations", () => {
    expect(resolveMcpAppsServers([], "default")).toEqual([]);
    expect(
      resolveMcpAppsServers(
        [asServer({ ...baseServer, agentId: "other" })],
        "default",
      ),
    ).toEqual([]);
  });
});
