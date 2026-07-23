import { describe, it, expect } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import type { CopilotRuntimeLike } from "../core/runtime";

/**
 * Regression tests for #5712.
 *
 * The v2 runtime forwards inbound `authorization` / `x-*` request headers onto
 * the outgoing agent call. Before the fix the forwarded inbound headers were
 * spread LAST, so an inbound header silently overrode the value the server
 * explicitly configured on the agent (e.g. a service-to-service bearer token),
 * breaking auth to a secured backend.
 *
 * After the fix, server-configured `agent.headers` are authoritative on
 * collision, while non-colliding inbound headers still forward (no regression
 * to the existing forward-for-auth use case).
 */
// Minimal runtime: configureAgentForRequest only reads a2ui / mcpApps /
// openGenerativeUI (all unset here) before performing the header merge.
const runtime = {
  a2ui: undefined,
  mcpApps: undefined,
  openGenerativeUI: undefined,
  // The /run call site reads the resolved forwarding policy off the runtime.
  forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
} as unknown as CopilotRuntimeLike;

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/copilotkit", {
    method: "POST",
    headers,
  });
}

// Case-insensitive lookup — the server configures canonical casing
// (`Authorization`) while forwarded inbound keys are lowercased.
function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  const match = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return match ? headers[match] : undefined;
}

describe("configureAgentForRequest — header precedence (#5712)", () => {
  it("server-configured agent headers win over a colliding inbound header", () => {
    // Server explicitly configures a service-to-service bearer + custom header.
    const agent = new HttpAgent({
      url: "https://agent.internal/run",
      headers: {
        Authorization: "Bearer SERVER-SERVICE-TOKEN",
        "X-Service-Key": "server-key",
      },
    });

    // Inbound request carries COLLIDING authorization + x-* (e.g. an
    // edge/platform-injected token) plus a non-colliding forwarded header.
    const request = makeRequest({
      Authorization: "Bearer INBOUND-CLIENT-TOKEN",
      "X-Service-Key": "inbound-key",
      "X-Tenant-Id": "tenant-123",
    });

    configureAgentForRequest({ runtime, request, agentId: "a", agent });

    const headers = (agent as unknown as { headers: Record<string, string> })
      .headers;

    // The server-configured values must reach the outgoing agent call.
    expect(getHeader(headers, "authorization")).toBe(
      "Bearer SERVER-SERVICE-TOKEN",
    );
    expect(getHeader(headers, "x-service-key")).toBe("server-key");

    // And there must be exactly ONE authorization key — a case-mismatched
    // duplicate (server `Authorization` + inbound `authorization`) is what
    // undici comma-joins into an invalid "multiple JWTs" value.
    const authKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === "authorization",
    );
    expect(authKeys).toHaveLength(1);

    // Same single-key uniqueness must hold for the x-* family: server
    // `X-Service-Key` + inbound `x-service-key` is the same case-mismatched
    // collision, and only the SERVER value may survive (an inbound-wins
    // regression would either flip the value or emit both keys).
    const serviceKeyKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === "x-service-key",
    );
    expect(serviceKeyKeys).toHaveLength(1);
    expect(headers[serviceKeyKeys[0]]).toBe("server-key");
  });

  it("forwards non-colliding inbound headers (no regression)", () => {
    const agent = new HttpAgent({
      url: "https://agent.internal/run",
      headers: {
        Authorization: "Bearer SERVER-SERVICE-TOKEN",
      },
    });

    const request = makeRequest({
      Authorization: "Bearer INBOUND-CLIENT-TOKEN",
      // A non-denylisted custom header — the default forwarding policy strips
      // `x-request-id`, so use `x-tenant-id` to exercise the no-regression
      // forward path without colliding with the breadth change.
      "X-Tenant-Id": "tenant-123",
    });

    configureAgentForRequest({ runtime, request, agentId: "a", agent });

    const headers = (agent as unknown as { headers: Record<string, string> })
      .headers;

    // Server header still authoritative...
    expect(getHeader(headers, "authorization")).toBe(
      "Bearer SERVER-SERVICE-TOKEN",
    );
    // ...and a header the server did NOT set still forwards through.
    expect(getHeader(headers, "x-tenant-id")).toBe("tenant-123");
  });
});
