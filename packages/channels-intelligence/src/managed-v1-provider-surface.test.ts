import { expect, test, vi } from "vitest";
import { LiveSessionAdapter } from "./live-session-adapter.js";
import {
  LiveDeliverySession,
  LiveSessionTransport,
} from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

function createHarness(
  adapterName: "slack" | "teams",
  options: {
    effectError?: (effect: Record<string, unknown>) => Error | undefined;
    log?: (message: string, meta?: unknown) => void;
  } = {},
) {
  const effects: Array<Record<string, unknown>> = [];
  const uploads: Array<{ filename: string; bytes: Uint8Array }> = [];
  const delivery: LiveSessionDelivery = {
    protocol: "channel_session_v1",
    deliveryId: `delivery-${adapterName}`,
    deliveryCode: `dcode-${adapterName}`,
    sessionTopic: `channel_session:delivery-${adapterName}`,
    canonicalThreadId: `thread-${adapterName}`,
    appUserId: `app-user-${adapterName}`,
    channelId: `channel-${adapterName}`,
    adapter: adapterName,
    turn: {
      id: `turn-${adapterName}`,
      eventId: `event-${adapterName}`,
      receivedAt: "2026-07-29T00:00:00.000Z",
      input: { kind: "text", text: "hello" },
    },
  };
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    on: () => undefined,
    leave: () => undefined,
    push: async (event, payload) => {
      if (
        event === "channel.effect.v1" &&
        typeof payload === "object" &&
        payload !== null &&
        "payload" in payload &&
        typeof payload.payload === "object" &&
        payload.payload !== null &&
        "effect" in payload.payload &&
        typeof payload.payload.effect === "object" &&
        payload.payload.effect !== null
      ) {
        const effect = payload.payload.effect as Record<string, unknown>;
        effects.push(effect);
        const effectError = options.effectError?.(effect);
        if (effectError) throw effectError;
        const seq = effect.seq as number;
        return { receivedThrough: seq, appliedThrough: seq };
      }
      return {};
    },
  };
  const projectSession: RealtimeGatewaySession = {
    on: () => undefined,
    push: async () => ({}),
  };
  const transport = new LiveSessionTransport({
    session: projectSession,
    runtimeInstanceId: "runtime-provider-surface",
  });
  const fileClient = {
    fetchFile: vi.fn(),
    uploadFile: vi.fn(
      async (
        _deliveryId: string,
        args: { filename: string; bytes: Uint8Array },
      ) => {
        uploads.push(args);
        return { handle: "file_image_1" };
      },
    ),
  };
  const session = new LiveDeliverySession(
    delivery,
    "runtime-provider-surface",
    deliveryChannel,
    fileClient as never,
  );
  const adapter = new LiveSessionAdapter({
    transport,
    loadHistory: async () => [],
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    log: options.log,
  });

  return { adapter, delivery, effects, session, uploads };
}

test("managed Slack sends native thread status through the delivery session", async () => {
  const harness = createHarness("slack");
  const renderer = harness.adapter.createRunRenderer({
    session: harness.session,
    delivery: harness.delivery,
  });

  try {
    await renderer.subscriber.onRunStartedEvent?.({ event: {} } as never);
    await renderer.subscriber.onRunFinishedEvent?.({ event: {} } as never);

    expect(
      harness.effects.map(({ kind, status }) => ({ kind, status })),
    ).toEqual([
      { kind: "slack.status", status: "is thinking…" },
      { kind: "slack.status", status: "" },
    ]);
  } finally {
    harness.session.leave();
  }
});

test("managed Teams sends best-effort typing before its first activity", async () => {
  const harness = createHarness("teams");
  const renderer = harness.adapter.createRunRenderer({
    session: harness.session,
    delivery: harness.delivery,
  });

  try {
    renderer.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "message-1" },
    } as never);
    renderer.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "message-1", delta: "Hello" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "message-1" },
    } as never);

    expect(harness.effects.map(({ kind }) => kind)).toEqual([
      "teams.typing",
      "teams.message.create",
    ]);
  } finally {
    harness.session.leave();
  }
});

test("managed Teams typing failure logs no raw provider or reference text", async () => {
  const log = vi.fn();
  const harness = createHarness("teams", {
    effectError: (effect) =>
      effect.kind === "teams.typing"
        ? new Error(
            "provider secret-typing-body for opaque pref_v1_secret-typing",
          )
        : undefined,
    log,
  });
  const renderer = harness.adapter.createRunRenderer({
    session: harness.session,
    delivery: harness.delivery,
  });

  try {
    await renderer.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "message-1" },
    } as never);
    await renderer.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "message-1", delta: "Hello" },
    } as never);
    await renderer.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "message-1" },
    } as never);

    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith("managed Teams typing failed", {
      errorCategory: "unknown",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-typing-body");
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "pref_v1_secret-typing",
    );
  } finally {
    harness.session.leave();
  }
});

test("managed Teams uploads image bytes and emits an image effect", async () => {
  const harness = createHarness("teams");

  try {
    await expect(
      harness.adapter.postFile(
        { session: harness.session, delivery: harness.delivery },
        {
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          filename: "chart.png",
          altText: "Quarterly chart",
        },
      ),
    ).resolves.toMatchObject({ ok: true, fileId: "file_image_1" });

    expect(harness.uploads).toHaveLength(1);
    expect(harness.effects).toMatchObject([
      {
        kind: "teams.image.create",
        fileHandle: "file_image_1",
        altText: "Quarterly chart",
      },
    ]);
  } finally {
    harness.session.leave();
  }
});

test("managed Teams rejects an image extension whose bytes do not match", async () => {
  const harness = createHarness("teams");

  try {
    await expect(
      harness.adapter.postFile(
        { session: harness.session, delivery: harness.delivery },
        {
          bytes: new TextEncoder().encode("not a PNG"),
          filename: "forged.png",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: "Teams image bytes do not match the filename",
    });

    expect(harness.uploads).toHaveLength(0);
    expect(harness.effects).toHaveLength(0);
  } finally {
    harness.session.leave();
  }
});
