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
      runner: { connect: connectSpy },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
        headers: {
          // Inbound headers that collide (canonical-cased server vs lowercased
          // inbound) — must lose — and one that doesn't — must still forward.
          Authorization: "Bearer inbound-user-token",
          "x-request-id": "req-123",
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
    expect(getHeader(headers, "x-request-id")).toBe("req-123");
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
      runner: { connect: connectSpy },
    } as any;

    const response = handleSseConnect({
      runtime: fakeRuntime,
      request: new Request("http://localhost/agent/weather-agent/connect", {
        method: "POST",
        headers: {
          // Allowlisted inbound headers (lowercased on extraction)...
          Authorization: "Bearer inbound-user-token",
          "x-request-id": "req-123",
          // ...and a non-allowlisted one that must NOT forward.
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

    // With no server headers to win, the inbound allowlisted headers forward
    // through unchanged...
    expect(getHeader(headers, "authorization")).toBe(
      "Bearer inbound-user-token",
    );
    expect(getHeader(headers, "x-request-id")).toBe("req-123");
    // ...and a non-allowlisted header is dropped (no crash, no over-forwarding).
    expect(getHeader(headers, "content-type")).toBeUndefined();
  });
});
