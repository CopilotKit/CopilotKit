import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentSubscriber, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import { EMPTY } from "rxjs";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultActivateChannel } from "../core/channel-manager";
import type { ChannelsIntelligenceModule } from "../core/channel-manager";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import {
  IntelligenceAgentRunner,
  STOP_RECORD_DEADLINE_MS,
} from "../runner/intelligence";
import { startFakeIntelligence } from "./helpers/fake-intelligence";
import type { ConnectMode, RenewMode } from "./helpers/fake-intelligence";

/**
 * A Channel run is stopped by the runtime when its delivery's signal aborts:
 * Intelligence superseded the delivery with a newer one, or the Channel
 * transport stopped. Neither goes through Intelligence's run stop, so without
 * a record the stopped run reads as a normal finish. The runtime records it
 * the way a browser's Stop does, before the terminal event.
 *
 * The real Channel run path (activation, canonical run, Intelligence runner,
 * Phoenix client) runs against a fake Intelligence on 127.0.0.1. Only the
 * channels-intelligence transport is replaced, through activation's importer
 * seam, by a caller that hands the run its delivery signal.
 */

type RunCanonical = Parameters<
  ChannelsIntelligenceModule["startChannelsOverRealtimeGateway"]
>[1]["runCanonical"];

const threadId = "550e8400-e29b-41d4-a716-446655440001";
const runId = "run_channel_1";
const terminal = `runner ${EventType.RUN_FINISHED}`;

class InnerAgent extends AbstractAgent {
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

let fake: Awaited<ReturnType<typeof startFakeIntelligence>>;
const pendingRuns: Array<() => void> = [];
const needsWebSocket = typeof globalThis.WebSocket === "undefined";

beforeEach(() => {
  // Node 20 has no global WebSocket; Node 22+ uses its native one.
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
});

afterEach(async () => {
  for (const finish of pendingRuns.splice(0)) finish();
  await fake?.close();
  if (needsWebSocket) vi.unstubAllGlobals();
});

async function activate(options: {
  connect: ConnectMode;
  renew?: RenewMode;
  lockHeartbeatIntervalSeconds?: number;
}): Promise<RunCanonical> {
  fake = await startFakeIntelligence({
    connect: options.connect,
    stop: "ok",
    ...(options.renew ? { renew: options.renew } : {}),
    agentId: "support",
  });
  const intelligence = new CopilotKitIntelligence({
    apiKey: "cpk-42_short_long",
    apiUrl: fake.apiUrl,
    wsUrl: fake.wsUrl,
  });
  const runner = new IntelligenceAgentRunner({
    url: intelligence.ɵgetRunnerWsUrl(),
    authToken: intelligence.ɵgetRunnerAuthToken(),
  });
  let captured: RunCanonical | undefined;
  await defaultActivateChannel(
    {
      wsUrl: fake.wsUrl,
      apiUrl: fake.apiUrl,
      apiKey: "cpk-42_short_long",
      projectId: 42,
      channelName: "support",
      runtimeInstanceId: "rti_test",
    },
    createChannel({ identifyUser: "platform", name: "support" }),
    async () => ({
      startChannelsOverRealtimeGateway: async (_channels, startOptions) => {
        captured = startOptions.runCanonical;
        return { metadata: {}, stop: async () => {} };
      },
    }),
    undefined,
    {
      runner,
      intelligence,
      lockTtlSeconds: 120,
      ...(options.lockHeartbeatIntervalSeconds !== undefined
        ? { lockHeartbeatIntervalSeconds: options.lockHeartbeatIntervalSeconds }
        : {}),
    },
  );
  if (!captured) throw new Error("runCanonical was not configured");
  return captured;
}

/** One delivery's run: it starts, then waits unless told to finish. */
function deliveryRun(signal: AbortSignal, finishOnItsOwn = false) {
  return {
    agent: new InnerAgent(),
    deliveryId: "dlv_delivery_1",
    signal,
    threadId,
    runId,
    userId: "app-user-1",
    agentId: "support",
    tools: [],
    context: [],
    persistedInputMessages: [],
    execute: async (subscriber: AgentSubscriber) => {
      const emit = (type: EventType) =>
        subscriber.onEvent?.({
          event: { type, threadId, runId } as BaseEvent,
        } as Parameters<NonNullable<AgentSubscriber["onEvent"]>>[0]);
      await emit(EventType.RUN_STARTED);
      if (finishOnItsOwn) {
        await emit(EventType.RUN_FINISHED);
      } else {
        await new Promise<void>((resolve) => pendingRuns.push(resolve));
      }
      return { iterations: 1, interrupted: false };
    },
  };
}

async function startDelivery(
  runCanonical: RunCanonical,
  finishOnItsOwn = false,
) {
  const delivery = new AbortController();
  const running = runCanonical(
    deliveryRun(delivery.signal, finishOnItsOwn),
  ).catch((error: unknown) => error);
  await vi.waitFor(() =>
    expect(fake.timeline).toContain(`runner ${EventType.RUN_STARTED}`),
  );
  return { delivery, running };
}

describe("a Channel run the runtime stops", () => {
  it.each(["superseded", "stopped"])(
    "records the stop before the terminal event when the delivery is %s",
    async (reason) => {
      const runCanonical = await activate({ connect: "ok" });
      const { delivery, running } = await startDelivery(runCanonical);

      delivery.abort(reason);
      await running;

      expect(fake.connectBodies).toEqual([
        { userId: "app-user-1", agentId: "support" },
      ]);
      const stopAt = fake.timeline.indexOf(`stop_run ${runId}`);
      expect(stopAt).toBeGreaterThan(-1);
      expect(
        fake.timeline.indexOf(`client join thread:${threadId}`),
      ).toBeLessThan(stopAt);
      expect(fake.timeline.indexOf(terminal)).toBeGreaterThan(stopAt);
    },
  );

  it("still stops at once when Intelligence refuses the join token", async () => {
    const runCanonical = await activate({ connect: "http-error" });
    const { delivery, running } = await startDelivery(runCanonical);

    const abortedAt = Date.now();
    delivery.abort("superseded");
    await running;

    expect(Date.now() - abortedAt).toBeLessThan(STOP_RECORD_DEADLINE_MS);
    expect(fake.timeline).toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
    expect(fake.timeline).toContain(terminal);
  });
});

describe("Channel runs that need no stop record", () => {
  it("send none when the run finishes normally", async () => {
    const runCanonical = await activate({ connect: "ok" });
    const { running } = await startDelivery(runCanonical, true);

    await running;

    expect(fake.timeline).toContain(terminal);
    expect(fake.timeline).not.toContain("POST /connect");
  });

  it("send none when Intelligence relayed the stop itself", async () => {
    const runCanonical = await activate({ connect: "ok" });
    const { running } = await startDelivery(runCanonical);

    fake.relayGatewayStop(runId);
    await running;

    expect(fake.timeline).toContain(terminal);
    expect(fake.timeline).not.toContain("POST /connect");
  });

  it("send none when the run stops because its lock was lost", async () => {
    const runCanonical = await activate({
      connect: "ok",
      renew: "lost",
      lockHeartbeatIntervalSeconds: 1,
    });
    const { running } = await startDelivery(runCanonical);

    await running;

    expect(fake.timeline).toContain("lock lost");
    expect(fake.timeline).toContain(terminal);
    expect(fake.timeline).not.toContain("POST /connect");
  });
});
