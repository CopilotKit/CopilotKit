import { describe, expect, it, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type { PlatformAdapter } from "@copilotkit/channels-core";
import { emoji } from "@copilotkit/channels-ui";
import type { ChannelProviderPayload } from "./delivery-contracts.js";
import { SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY } from "./delivery-contracts.js";
import type {
  ClaimedChannelDelivery,
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
    surfaceId: "surface_support_01",
    canonicalThreadId: "thread_teams_final",
    appUserId: "teams:user-1",
    adapter: "teams",
    turn: {
      eventId: "evt_teams_final",
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_message_final_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      },
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
      const session = { effect } as unknown as ClaimedChannelDelivery;
      const renderer = adapter().createRunRenderer({
        claimedDelivery: session,
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

describe("DeliveryAdapter managed reactions", () => {
  it("keys a posted message by the Gateway's stable provider correlation id", async () => {
    const effect = vi.fn(async () => ({
      providerReference: "pref_v1_teams_activity_01",
      providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    }));
    const session = { effect } as unknown as ClaimedChannelDelivery;

    await expect(
      adapter().post({ claimedDelivery: session, delivery: delivery() }, [
        { type: "text", props: { value: "hello" } },
      ]),
    ).resolves.toMatchObject({
      id: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
      providerReference: "pref_v1_teams_activity_01",
    });
  });

  it("adds a Teams reaction through an opaque provider reference", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;
    const target = { claimedDelivery: session, delivery: delivery() };
    const messageRef = {
      id: "pref_v1_teams_activity_01",
      responseId: "response_01",
      claimedDelivery: session,
      adapter: "teams",
      providerReference: "pref_v1_teams_activity_01",
    };

    await expect(
      managed.addReaction?.(target, messageRef, emoji.thumbs_up),
    ).resolves.toEqual({ ok: true });
    expect(effect).toHaveBeenCalledWith(expect.any(String), {
      kind: "teams.reaction.add",
      providerReference: "pref_v1_teams_activity_01",
      reaction: "like",
    });
  });

  it("passes a provider-native Teams reaction through for provider validation", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const managed = adapter() as PlatformAdapter;
    const target = { claimedDelivery: session, delivery: delivery() };
    const messageRef = {
      id: "pref_v1_teams_activity_01",
      responseId: "response_01",
      claimedDelivery: session,
      adapter: "teams" as const,
      providerReference: "pref_v1_teams_activity_01",
    };

    await expect(
      managed.addReaction?.(target, messageRef, "provider_native_reaction"),
    ).resolves.toEqual({ ok: true });
    expect(effect).toHaveBeenCalledWith(expect.any(String), {
      kind: "teams.reaction.add",
      providerReference: "pref_v1_teams_activity_01",
      reaction: "provider_native_reaction",
    });
  });
});

describe("DeliveryAdapter managed deletes", () => {
  it("deletes a Teams message through its opaque provider reference", async () => {
    const effect = vi.fn(async () => ({}));
    const session = { effect } as unknown as ClaimedChannelDelivery;

    await adapter().delete({
      id: "pref_v1_teams_activity_01",
      responseId: "response_01",
      claimedDelivery: session,
      adapter: "teams",
      providerReference: "pref_v1_teams_activity_01",
    });

    expect(effect).toHaveBeenCalledWith("response_01", {
      kind: "teams.message.delete",
      providerReference: "pref_v1_teams_activity_01",
    });
  });
});

describe("DeliveryAdapter Slack cadence", () => {
  it("uses unmetered native status for run start and terminal clear", async () => {
    const effect = vi.fn(
      async (
        _responseId: string,
        _payload: ChannelProviderPayload,
        _options?: { charge?: boolean },
      ): Promise<Record<string, unknown>> => ({}),
    );
    const session = { effect } as unknown as ClaimedChannelDelivery;
    const renderer = adapter().createRunRenderer({
      claimedDelivery: session,
      delivery: { ...delivery(), adapter: "slack" },
    });

    await renderer.subscriber.onRunStartedEvent!({ event: {} } as never);
    await renderer.finish!();

    expect(effect.mock.calls).toEqual([
      [
        expect.any(String),
        { kind: "slack.thread.status", status: "is thinking…" },
        { charge: false, bestEffort: true },
      ],
      [
        expect.any(String),
        { kind: "slack.thread.status", status: "" },
        { charge: false, bestEffort: true },
      ],
    ]);
  });

  it("does not let a native status failure block visible output", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const effect = vi.fn(
        async (
          _responseId: string,
          payload: ChannelProviderPayload,
        ): Promise<Record<string, unknown>> => {
          if ((payload as { kind: string }).kind === "slack.thread.status") {
            throw new Error("status unavailable");
          }
          return (payload as { kind: string }).kind === "slack.stream.start"
            ? { providerReference: "pref_v1_slack_stream_01" }
            : {};
        },
      );
      const session = { effect } as unknown as ClaimedChannelDelivery;
      const renderer = adapter().createRunRenderer({
        claimedDelivery: session,
        delivery: { ...delivery(), adapter: "slack" },
      });

      await renderer.subscriber.onRunStartedEvent!({ event: {} } as never);
      renderer.subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: "Hello" },
      } as never);
      await vi.advanceTimersByTimeAsync(0);

      expect(
        effect.mock.calls.some(
          (call) => (call[1] as { kind: string }).kind === "slack.stream.start",
        ),
      ).toBe(true);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("clears native status on the first visible stream", async () => {
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
      const session = { effect } as unknown as ClaimedChannelDelivery;
      const renderer = adapter().createRunRenderer({
        claimedDelivery: session,
        delivery: { ...delivery(), adapter: "slack" },
      });

      await renderer.subscriber.onRunStartedEvent!({ event: {} } as never);
      renderer.subscriber.onTextMessageContentEvent!({
        event: { messageId: "message-1", delta: "Hello" },
      } as never);
      await vi.advanceTimersByTimeAsync(0);

      expect(
        effect.mock.calls
          .map((call) => call[1])
          .filter(
            (payload) =>
              (payload as { kind: string }).kind === "slack.thread.status",
          ),
      ).toEqual([
        { kind: "slack.thread.status", status: "is thinking…" },
        { kind: "slack.thread.status", status: "" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

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
      const session = { effect } as unknown as ClaimedChannelDelivery;
      const renderer = adapter().createRunRenderer({
        claimedDelivery: session,
        delivery: {
          ...delivery(),
          adapter: "slack",
          capabilities: [SLACK_STREAM_APPEND_FULL_TEXT_CAPABILITY],
        },
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

      expect(effect.mock.calls.map((call) => call[1])).toContainEqual({
        kind: "slack.stream.start",
        initialText: "A",
      });
      expect(appendPayloads()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(appendPayloads()).toEqual([
        {
          kind: "slack.stream.append",
          providerReference: "pref_v1_slack_stream_01",
          delta: "B",
          fullText: "AB",
        },
      ]);

      await subscriber.onTextMessageEndEvent!({
        event: { messageId: "message-1" },
      } as never);
      await renderer.finish!();
    } finally {
      vi.useRealTimers();
    }
  });
});
