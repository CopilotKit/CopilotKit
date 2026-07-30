import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type { ChannelProviderPayload } from "./delivery-contracts.js";
import type {
  ChannelDeliverySession,
  PreparedChannelDelivery,
} from "./delivery-transport.js";

function adapter(): DeliveryAdapter {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

function delivery(): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_teams_final_01",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_support",
    channelName: "support",
    canonicalThreadId: "thread_teams_final",
    appUserId: "teams:user-1",
    adapter: "teams",
    turn: {
      eventId: "evt_teams_final",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: { kind: "text", text: "hello" },
    },
  };
}

describe("DeliveryAdapter Teams final delivery", () => {
  it("emits a distinct final packet after an intermediate post", async () => {
    vi.useFakeTimers();
    try {
      const effect = vi.fn(
        async (
          _responseId: string,
          _payload: ChannelProviderPayload,
        ): Promise<Record<string, unknown>> => ({
          providerReference: "pref_v1_teams_activity_01",
        }),
      );
      const session = { effect } as unknown as ChannelDeliverySession;
      const renderer = adapter().createRunRenderer({
        session,
        delivery: delivery(),
      });
      const subscriber = renderer.subscriber;

      subscriber.onTextMessageStartEvent!({
        event: { messageId: "message-1", role: "assistant" },
      } as never);
      subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: "Working" },
      } as never);
      await vi.advanceTimersByTimeAsync(1);

      subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: " done" },
      } as never);
      await subscriber.onTextMessageEndEvent!({
        event: { messageId: "message-1" },
      } as never);

      expect(effect.mock.calls.map((call) => call[1])).toEqual([
        { kind: "teams.message.create", text: "Working" },
        {
          kind: "teams.message.finalize",
          providerReference: "pref_v1_teams_activity_01",
          text: "Working done",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DeliveryAdapter Slack cadence", () => {
  it("coalesces intermediate text on the 600 millisecond attempt cadence", async () => {
    vi.useFakeTimers();
    try {
      const effect = vi.fn(
        async (
          _responseId: string,
          payload: ChannelProviderPayload,
        ): Promise<Record<string, unknown>> =>
          payload.kind === "slack.stream.start"
            ? { providerReference: "pref_v1_slack_stream_01" }
            : {},
      );
      const session = { effect } as unknown as ChannelDeliverySession;
      const renderer = adapter().createRunRenderer({
        session,
        delivery: { ...delivery(), adapter: "slack" },
      });
      const subscriber = renderer.subscriber;

      subscriber.onTextMessageStartEvent!({
        event: { messageId: "message-1", role: "assistant" },
      } as never);
      subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: "A" },
      } as never);
      await vi.advanceTimersByTimeAsync(0);

      subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: "B" },
      } as never);
      await vi.advanceTimersByTimeAsync(599);

      const appendPayloads = (): unknown[] =>
        effect.mock.calls
          .map((call) => call[1])
          .filter((payload) => payload.kind === "slack.stream.append");

      expect(appendPayloads()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(appendPayloads()).toHaveLength(2);

      await subscriber.onTextMessageEndEvent!({
        event: { messageId: "message-1" },
      } as never);
      await renderer.finish!();
    } finally {
      vi.useRealTimers();
    }
  });
});
