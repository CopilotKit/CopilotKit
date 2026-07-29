import { expect, test, vi } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { startChannelsWithGatewaySession } from "./realtime-gateway-launcher.js";
import type {
  LiveSessionDelivery,
  LiveSessionTurnInput,
} from "./live-session-transport.js";

interface ObservedEffect {
  kind: string;
  responseId: string;
  seq: number;
  providerReference?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEffect(value: unknown): ObservedEffect {
  if (
    !isRecord(value) ||
    !isRecord(value.payload) ||
    !isRecord(value.payload.effect)
  ) {
    throw new TypeError("Expected a provider effect envelope");
  }
  const effect = value.payload.effect;
  if (
    typeof effect.kind !== "string" ||
    typeof effect.responseId !== "string" ||
    typeof effect.seq !== "number" ||
    (effect.providerReference !== undefined &&
      typeof effect.providerReference !== "string")
  ) {
    throw new TypeError("Expected provider effect fields");
  }
  return {
    kind: effect.kind,
    responseId: effect.responseId,
    seq: effect.seq,
    ...(effect.providerReference
      ? { providerReference: effect.providerReference }
      : {}),
  };
}

class InteractionReferenceGatewaySession implements RealtimeGatewaySession {
  readonly projectHandlers = new Map<string, (payload: unknown) => void>();
  readonly pushes: Array<{ event: string; payload: unknown }> = [];
  leaves = 0;

  push(event: string, payload: unknown): Promise<unknown> {
    this.pushes.push({ event, payload });
    return Promise.resolve({});
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.projectHandlers.set(event, handler);
  }

  async join(
    _topic: string,
    _payload: unknown,
  ): Promise<RealtimeGatewayDeliveryChannel> {
    return {
      push: async (event, payload) => {
        this.pushes.push({ event, payload });
        if (event === "channel.effect.v1") {
          const { seq } = readEffect(payload);
          return { receivedThrough: seq, appliedThrough: seq };
        }
        return {};
      },
      on: () => undefined,
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
}

function interactionDelivery(input: LiveSessionTurnInput): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "delivery-interaction-ref",
    deliveryCode: "delivery-code-interaction-ref",
    sessionTopic: "channel_session:delivery-interaction-ref",
    canonicalThreadId: "thread-interaction-ref",
    appUserId: "app-user-interaction-ref",
    channelId: "channel-interaction-ref",
    adapter: "slack",
    turn: {
      id: "turn-interaction-ref",
      eventId: "event-interaction-ref",
      receivedAt: new Date().toISOString(),
      input,
      actor: {
        externalUserId: "slack-user-interaction-ref",
        displayName: "Ada",
      },
    },
  };
}

async function setupInteractionReferenceHandler() {
  const gateway = new InteractionReferenceGatewaySession();
  const channel = createChannel({ name: "support" });
  let sourceRefId: string | undefined;
  channel.onInteraction("approve", async ({ thread, message }) => {
    sourceRefId = message.ref.id;
    await thread.update(
      message.ref,
      Section({ children: "Updated interaction message" }),
    );
    await thread.delete(message.ref);
  });
  const handle = await startChannelsWithGatewaySession([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "runtime-interaction-ref",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  return {
    gateway,
    getSourceRefId: () => sourceRefId,
    teardown: () => handle.stop(),
  };
}

async function setupRejectedInteractionReference() {
  const gateway = new InteractionReferenceGatewaySession();
  const handler = vi.fn();
  const channel = createChannel({ name: "support" });
  channel.onInteraction("approve", handler);
  const handle = await startChannelsWithGatewaySession([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "runtime-interaction-ref",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  return {
    gateway,
    handler,
    teardown: () => handle.stop(),
  };
}

test("managed interaction update and delete preserve only the opaque provider reference", async () => {
  const providerReference = "pref_v1_opaqueReference_123";
  const { gateway, getSourceRefId, teardown } =
    await setupInteractionReferenceHandler();

  try {
    await gateway.deliver(
      interactionDelivery({
        kind: "interaction",
        actionId: "approve",
        value: true,
        messageRef: { id: providerReference },
      }),
    );
    const effects = gateway.pushes
      .filter(({ event }) => event === "channel.effect.v1")
      .map(({ payload }) => readEffect(payload));

    expect(getSourceRefId()).toBe(providerReference);
    expect(gateway.pushes.map(({ event }) => event)).toEqual([
      "channel.effect.v1",
      "channel.effect.v1",
      "channel.delivery.complete.v1",
    ]);
    expect(effects).toMatchObject([
      {
        kind: "slack.message.replace",
        responseId: expect.stringMatching(/^response_/),
        providerReference,
      },
      {
        kind: "slack.message.delete",
        responseId: expect.stringMatching(/^response_/),
        providerReference,
      },
    ]);
    expect(effects[1]!.responseId).toBe(effects[0]!.responseId);
  } finally {
    await teardown();
  }
});

test.each(["1712345678.123456", "pref_v1_"])(
  "managed interaction rejects non-capability source ref %s before handler dispatch",
  async (providerReference) => {
    const { gateway, handler, teardown } =
      await setupRejectedInteractionReference();

    try {
      await gateway.deliver(
        interactionDelivery({
          kind: "interaction",
          actionId: "approve",
          messageRef: { id: providerReference },
        }),
      );

      expect(handler).not.toHaveBeenCalled();
      expect(gateway.pushes.map(({ event }) => event)).toEqual([
        "channel.delivery.fail.v1",
      ]);
      expect(gateway.pushes[0]!.payload).toMatchObject({
        reason: expect.stringContaining("opaque pref_v1 capability"),
      });
    } finally {
      await teardown();
    }
  },
);
