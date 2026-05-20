import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { EventType, type BaseEvent } from "@ag-ui/client";

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
