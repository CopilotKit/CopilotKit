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
    ["includeTools", []],
    ["includeTools", null],
    ["includeTools", "get_weather"],
    ["excludeTools", []],
    ["excludeTools", null],
    ["excludeTools", "delete_account"],
  ])("rejects a defined %s value of any shape", (key, value) => {
    expect(() =>
      resolveMcpAppsServers(
        [asServer({ ...baseServer, [key]: value })],
        "default",
      ),
    ).toThrow(
      new RegExp(
        `${key}.*server\\[0\\].*weather.*@ag-ui/mcp-apps-middleware@0\\.0\\.3.*https://github\\.com/CopilotKit/CopilotKit/issues/5930`,
      ),
    );
  });

  it("reports every unsupported key before filtering by agent", () => {
    expect(() =>
      resolveMcpAppsServers(
        [
          asServer({
            ...baseServer,
            serverId: "other",
            agentId: "other",
            includeTools: [],
          }),
          asServer({
            ...baseServer,
            serverId: "current",
            agentId: "current",
            excludeTools: null,
          }),
        ],
        "current",
      ),
    ).toThrow(
      /includeTools at server\[0\] \(other\).*excludeTools at server\[1\] \(current\)/,
    );
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
