import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";

vi.mock("pino", () => ({
  default: vi.fn(() => ({
    child: vi.fn(() => ({ debug: vi.fn() })),
    debug: vi.fn(),
  })),
}));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import { handleSseConnect } from "../connect";
import { DebugEventBus } from "../../../core/debug-event-bus";
import { resolveForwardHeadersPolicy } from "../../header-utils";
import type { ResolvedForwardHeadersPolicy } from "../../header-utils";

// Default resolved policy (built-in denylist on), shared across the fake
// runtimes below so the /connect call site has a policy to read.
const defaultPolicy = resolveForwardHeadersPolicy(undefined);

/**
 * Regression guard for the agentId forwarding fix. `handleSseConnect` used
 * to hardcode `agentId: "connect"` in every debug envelope emitted on
 * /agent/:agentId/connect; the fix threads the route-resolved agentId
 * through to `createSseEventResponse`. Reverting that change would make
 * this test fail — the /run-based integration coverage wouldn't catch it
 * because /run is a different code path.
 */
describe("handleSseConnect → debug envelope agentId", () => {
  it("forwards the real agentId into envelopes on /connect", async () => {
    const bus = new DebugEventBus();
    const received: Array<{ agentId: string }> = [];
    bus.subscribe((envelope) => {
      received.push({ agentId: envelope.agentId });
    });

    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;

    const fakeRuntime = {
      debugEventBus: bus,
      forwardHeadersPolicy: defaultPolicy,
      runner: {
        connect: () => of(event),
      },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
      }),
      agentId: "weather-agent",
      threadId: "t-1",
    });

    // Drain to let the observable subscription fire.
    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(received.length).toBeGreaterThan(0);
    for (const env of received) {
      // A revert to the pre-fix hardcoded "connect" would fail this
      // positive assertion — no need for a separate not-toBe guard.
      expect(env.agentId).toBe("weather-agent");
    }
  });
});

/**
 * Regression guard for issue #5712 on the /connect path. `handleSseConnect`
 * used to forward raw inbound `authorization`/`x-*` headers straight to
 * `runner.connect`, ignoring server-configured `agent.headers` entirely — so
 * an inbound bearer silently clobbered service-to-service auth. The fix merges
 * with server config winning on collision (case-insensitively), while
 * non-colliding forwarded headers still pass through. The /run-based coverage
 * (agent-header-precedence.test.ts) wouldn't catch a /connect regression — it
 * is a separate code path.
 */
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

describe("handleSseConnect → header precedence (#5712)", () => {
  it("server-configured agent headers win over a colliding forwarded header", async () => {
    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;

    const connectSpy = vi.fn(
      (_req: { threadId: string; headers: Record<string, string> }) =>
        of(event),
    );
    const fakeRuntime = {
      debugEventBus: new DebugEventBus(),
      forwardHeadersPolicy: defaultPolicy,
      runner: { connect: connectSpy },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
        headers: {
          // Inbound headers that collide (canonical-cased server vs lowercased
          // inbound) — must lose — and one that doesn't — must still forward.
          // Use a non-denylisted custom header so the default forwarding policy
          // (which strips `x-request-id`) doesn't drop it for an unrelated
          // reason; this test is about precedence, not breadth.
          Authorization: "Bearer inbound-user-token",
          "x-tenant-id": "tenant-123",
        },
      }),
      agentId: "weather-agent",
      threadId: "t-1",
      agent: {
        headers: { Authorization: "Bearer service-token" },
      } as any,
    });

    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const headers = connectSpy.mock.calls[0][0].headers;

    // Server-set auth wins on collision...
    expect(getHeader(headers, "authorization")).toBe("Bearer service-token");
    // ...with exactly one authorization key (no case-mismatched duplicate that
    // undici would comma-join into an invalid "multiple JWTs" value)...
    const authKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === "authorization",
    );
    expect(authKeys).toHaveLength(1);
    // ...and a non-colliding forwarded header still passes through.
    expect(getHeader(headers, "x-tenant-id")).toBe("tenant-123");
  });

  it("forwards inbound allowlisted headers when no server agent.headers exist", async () => {
    // The connect path passes `agent?.headers` (undefined when no agent clone
    // carries server-configured headers) into `mergeForwardableHeaders`, which
    // must degrade to `?? {}` without crashing and forward the inbound
    // allowlisted headers only.
    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;

    const connectSpy = vi.fn(
      (_req: { threadId: string; headers: Record<string, string> }) =>
        of(event),
    );
    const fakeRuntime = {
      debugEventBus: new DebugEventBus(),
      forwardHeadersPolicy: defaultPolicy,
      runner: { connect: connectSpy },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
        headers: {
          // Forwardable inbound headers (lowercased on extraction)...
          Authorization: "Bearer inbound-user-token",
          "x-tenant-id": "tenant-123",
          // ...and a non-forwardable one that must NOT forward.
          "content-type": "application/json",
        },
      }),
      agentId: "weather-agent",
      threadId: "t-1",
      // No `agent` — the `agent?.headers ?? {}` path.
    });

    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const headers = connectSpy.mock.calls[0][0].headers;

    // With no server headers to win, the inbound forwardable headers forward
    // through unchanged...
    expect(getHeader(headers, "authorization")).toBe(
      "Bearer inbound-user-token",
    );
    expect(getHeader(headers, "x-tenant-id")).toBe("tenant-123");
    // ...and a non-forwardable header is dropped (no crash, no over-forwarding).
    expect(getHeader(headers, "content-type")).toBeUndefined();
  });
});

/**
 * Regression guard for #5712 breadth on the /connect path: the default
 * forwarding policy must strip known infra/proxy/platform headers, mirroring
 * the /run path so the two never diverge.
 */
describe("handleSseConnect → forwarding-policy breadth (#5712)", () => {
  function drainAndGetHeaders(
    connectSpy: ReturnType<typeof vi.fn>,
    policy: ResolvedForwardHeadersPolicy,
    requestHeaders: Record<string, string>,
  ): Promise<Record<string, string>> {
    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;
    connectSpy.mockImplementation(() => of(event));

    const fakeRuntime = {
      debugEventBus: new DebugEventBus(),
      forwardHeadersPolicy: policy,
      runner: { connect: connectSpy },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
        headers: requestHeaders,
      }),
      agentId: "weather-agent",
      threadId: "t-1",
    });

    return (async () => {
      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      return connectSpy.mock.calls[0][0].headers as Record<string, string>;
    })();
  }

  it("strips denylisted infra/platform headers while forwarding custom x-*", async () => {
    const connectSpy = vi.fn();
    const headers = await drainAndGetHeaders(connectSpy, defaultPolicy, {
      "X-Forwarded-For": "203.0.113.7",
      "X-Vercel-Id": "iad1::abc",
      "X-Copilotcloud-Public-Api-Key": "ck_pub_secret",
      "X-Tenant-Id": "tenant-123",
      Authorization: "Bearer user-token",
    });

    expect(getHeader(headers, "x-forwarded-for")).toBeUndefined();
    expect(getHeader(headers, "x-vercel-id")).toBeUndefined();
    expect(getHeader(headers, "x-copilotcloud-public-api-key")).toBeUndefined();
    expect(getHeader(headers, "x-tenant-id")).toBe("tenant-123");
    expect(getHeader(headers, "authorization")).toBe("Bearer user-token");
  });

  it("applies a custom forwardHeaders policy from the runtime (plumb-through)", async () => {
    const connectSpy = vi.fn();
    const headers = await drainAndGetHeaders(
      connectSpy,
      resolveForwardHeadersPolicy({ useDefaultDenylist: false }),
      { "X-Forwarded-For": "203.0.113.7", "X-Tenant-Id": "tenant-123" },
    );

    // Denylist disabled → infra header forwards again, proving plumb-through.
    expect(getHeader(headers, "x-forwarded-for")).toBe("203.0.113.7");
    expect(getHeader(headers, "x-tenant-id")).toBe("tenant-123");
  });
});
