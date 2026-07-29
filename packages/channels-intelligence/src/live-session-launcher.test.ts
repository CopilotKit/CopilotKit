import { describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { AgentSubscriber, BaseEvent, RunAgentResult } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { createChannel } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { startChannelsWithGatewaySession } from "./realtime-gateway-launcher.js";
import { LiveDeliverySession } from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";

class ScriptedAgent extends AbstractAgent {
  override async runAgent(
    _parameters?: unknown,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const events: BaseEvent[] = [
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "message-1",
        role: "assistant",
      } as BaseEvent,
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
        delta: "Hello",
      } as BaseEvent,
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "message-1",
      } as BaseEvent,
    ];
    for (const event of events) {
      if (event.type === EventType.TEXT_MESSAGE_START) {
        await subscriber?.onTextMessageStartEvent?.({ event } as never);
      } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        await subscriber?.onTextMessageContentEvent?.({
          event,
          textMessageBuffer: "Hello",
        } as never);
      } else {
        await subscriber?.onTextMessageEndEvent?.({
          event,
          textMessageBuffer: "Hello",
        } as never);
      }
    }
    return { result: undefined, newMessages: [] };
  }

  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

class FakeGatewaySession implements RealtimeGatewaySession {
  readonly projectHandlers = new Map<string, (payload: unknown) => void>();
  readonly deliveryHandlers = new Map<string, (payload: unknown) => void>();
  readonly pushes: Array<{ event: string; payload: unknown }> = [];
  readonly joined: Array<{ topic: string; payload: unknown }> = [];
  leaves = 0;

  push(event: string, payload: unknown): Promise<unknown> {
    this.pushes.push({ event, payload });
    return Promise.resolve({});
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.projectHandlers.set(event, handler);
  }

  async join(
    topic: string,
    payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    this.joined.push({ topic, payload });
    return {
      push: async (event, body) => {
        this.pushes.push({ event, payload: body });
        if (event === "channel.run.open.v1") {
          const request = body as { callId: string; responseId: string };
          return {
            deliveryId: "dlv_test",
            callId: request.callId,
            responseId: request.responseId,
            threadId: "thread-test",
            runId: "run-test",
            runnerToken: "rnr_test",
            runnerTokenExpiresAt: new Date().toISOString(),
          };
        }
        if (event === "channel.effect.v1") {
          const seq = (body as { payload: { effect: { seq: number } } }).payload
            .effect.seq;
          return { receivedThrough: seq, appliedThrough: seq };
        }
        return {};
      },
      on: (event, handler) => {
        this.deliveryHandlers.set(event, handler);
      },
      leave: () => {
        this.leaves += 1;
      },
    };
  }

  async deliver(delivery: LiveSessionDelivery): Promise<void> {
    this.projectHandlers.get("channel.delivery.v1")?.(delivery);
    await vi.waitFor(() => {
      expect(this.leaves).toBe(1);
    });
  }

  cancelRun(payload: unknown): void {
    this.deliveryHandlers.get("channel.run.cancel.v1")?.(payload);
  }
}

function delivery(
  input: LiveSessionDelivery["turn"]["input"] = {
    kind: "text",
    text: "Hi",
  },
): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "dlv_test",
    deliveryCode: "dcode_test",
    sessionTopic: "channel_session:dlv_test",
    canonicalThreadId: "thread-test",
    appUserId: "app-user-test",
    channelId: "channel_test",
    adapter: "slack",
    turn: {
      id: "turn-test",
      eventId: "event-test",
      receivedAt: new Date().toISOString(),
      input,
      actor: {
        externalUserId: "slack-user",
        displayName: "Ada",
      },
    },
  };
}

describe("live session launcher", () => {
  it("renews SDK liveness every 20 seconds until the delivery leaves", async () => {
    vi.useFakeTimers();
    const pushes: string[] = [];
    const channel: RealtimeGatewayDeliveryChannel = {
      push: async (event) => {
        pushes.push(event);
        return {};
      },
      on: () => undefined,
      leave: () => undefined,
    };
    const session = new LiveDeliverySession(
      delivery(),
      "rti_test",
      channel,
      undefined,
      20_000,
    );

    await vi.advanceTimersByTimeAsync(40_000);
    expect(pushes).toEqual([
      "channel.session.heartbeat.v1",
      "channel.session.heartbeat.v1",
    ]);

    session.leave();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pushes).toHaveLength(2);
    vi.useRealTimers();
  });

  it("loads canonical history and wraps one public run in one Gateway run", async () => {
    const gateway = new FakeGatewaySession();
    const runCanonical = vi.fn(async (args) => args.execute({}));
    const loadHistory = vi.fn(async () => [
      { id: "history-1", role: "user" as const, content: "Earlier" },
    ]);
    const agent = new ScriptedAgent();
    const channel = createChannel({
      name: "support",
      agent: () => agent,
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    const handle = await startChannelsWithGatewaySession([channel], {
      session: gateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: "rti_test",
      runCanonical,
      loadHistory,
    });
    await gateway.deliver(delivery());

    expect(loadHistory).toHaveBeenCalledWith({
      threadId: "thread-test",
      appUserId: "app-user-test",
    });
    expect(runCanonical).toHaveBeenCalledTimes(1);
    expect(runCanonical.mock.calls[0]![0]).toMatchObject({
      threadId: "thread-test",
      runId: "run-test",
      runnerToken: "rnr_test",
      persistedInputMessages: [
        expect.objectContaining({ role: "user", content: "Hi" }),
      ],
    });
    expect(gateway.pushes.map(({ event }) => event)).toEqual([
      "channel.run.open.v1",
      "channel.effect.v1",
      "channel.effect.v1",
      "channel.run.close.v1",
      "channel.effect.v1",
      "channel.delivery.complete.v1",
    ]);
    const effects = gateway.pushes
      .filter(({ event }) => event === "channel.effect.v1")
      .map(
        ({ payload }) =>
          (payload as { payload: { effect: { kind: string; seq: number } } })
            .payload.effect,
      );
    expect(effects.map(({ kind }) => kind)).toEqual([
      "slack.stream.start",
      "slack.stream.append",
      "slack.stream.stop",
    ]);
    expect(effects.map(({ seq }) => seq)).toEqual([0, 1, 2]);

    await handle.stop();
  });

  it("forwards a matching Gateway run cancellation to the canonical run signal", async () => {
    const gateway = new FakeGatewaySession();
    let observedSignal: AbortSignal | undefined;
    const runCanonical = vi.fn(
      (args) =>
        new Promise<never>((_resolve, reject) => {
          observedSignal = args.abortSignal;
          if (!observedSignal) return;
          const rejectCancellation = () => {
            reject(new Error(String(observedSignal?.reason)));
          };
          if (observedSignal.aborted) {
            rejectCancellation();
          } else {
            observedSignal.addEventListener("abort", rejectCancellation, {
              once: true,
            });
          }
        }),
    );
    const channel = createChannel({
      name: "support",
      agent: () => new ScriptedAgent(),
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });

    const handle = await startChannelsWithGatewaySession([channel], {
      session: gateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: "rti_test",
      runCanonical,
      loadHistory: async () => [],
    });
    const delivered = gateway.deliver(delivery());

    await vi.waitFor(() => expect(runCanonical).toHaveBeenCalledOnce());
    expect(observedSignal).toBeDefined();
    const open = gateway.pushes.find(
      ({ event }) => event === "channel.run.open.v1",
    );
    const callId = (open?.payload as { callId?: string } | undefined)?.callId;
    expect(callId).toEqual(expect.any(String));

    gateway.cancelRun({
      protocol: "channel_session_v1",
      deliveryId: "dlv_test",
      callId,
      reason: "gateway_drain_timeout",
    });
    await delivered;

    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe("gateway_drain_timeout");
    expect(gateway.pushes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "channel.run.close.v1",
          payload: expect.objectContaining({ status: "failed" }),
        }),
        expect.objectContaining({
          event: "channel.delivery.fail.v1",
          payload: expect.objectContaining({
            reason: "gateway_drain_timeout",
          }),
        }),
      ]),
    );

    await handle.stop();
  });

  it("completes a direct-only handler without opening an agent run", async () => {
    const gateway = new FakeGatewaySession();
    const channel = createChannel({ name: "support" });
    channel.onMention(async ({ thread }) => {
      await thread.post(Section({ children: "Direct reply" }));
    });

    const handle = await startChannelsWithGatewaySession([channel], {
      session: gateway,
      scope: { projectId: 1, channelName: "support" },
      runtimeInstanceId: "rti_test",
      runCanonical: async (args) => args.execute({}),
      loadHistory: async () => [],
    });
    await gateway.deliver(delivery());

    expect(gateway.pushes.map(({ event }) => event)).toEqual([
      "channel.effect.v1",
      "channel.delivery.complete.v1",
    ]);
    expect(
      (
        gateway.pushes[0]!.payload as {
          payload: { effect: { kind: string; blocks: unknown[] } };
        }
      ).payload.effect,
    ).toMatchObject({
      kind: "slack.message.create",
      blocks: expect.any(Array),
    });

    await handle.stop();
  });
});
