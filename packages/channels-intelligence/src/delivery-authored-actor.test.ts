import { createChannel } from "@copilotkit/channels-core";
import type { ChannelAuthoredActor } from "@copilotkit/channels-ui";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { ChannelDeliveryTransport } from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

/**
 * Contract tests for CopilotKit/CopilotKit#6751 — a turn composed on an
 * application surface (a web composer continuing a Slack thread) delivered
 * through the ordinary managed path.
 *
 * The invariant these pin down is that an application turn is an ordinary
 * delivery in every respect except who is named as its author. Nothing about
 * routing, identity resolution or the provider actor may change, because the
 * two surfaces are meant to be one conversation.
 */

const AUTHORED_BY: ChannelAuthoredActor = {
  kind: "application",
  surface: "web",
  appUserId: "openbot:user-42",
  displayName: "Jerel via OpenBot",
};

const SHARED_THREAD_ID = "thread_authored_fifo";
const PROVIDER_DELIVERY_ID = "dlv_authoredFifoProvider";
const APPLICATION_DELIVERY_ID = "dlv_authoredFifoApplication";

/** One claimed-and-acknowledged delivery topic, mirroring the transport suite. */
function deliveryChannel(
  joinReply: PreparedChannelDelivery,
): RealtimeGatewayDeliveryChannel {
  return {
    joinReply,
    push: vi.fn().mockImplementation((_event, packet) => {
      const identity = packet as {
        deliveryId: string;
        seq: number;
        packetId: string;
      };
      return Promise.resolve({
        deliveryId: identity.deliveryId,
        seq: identity.seq,
        packetId: identity.packetId,
        phase: "applied",
        result: { providerReference: "pref_v1_message_authored" },
      });
    }),
    on: vi.fn(),
    onClose: vi.fn(),
    leave: vi.fn(),
  };
}

function claimResult(deliveryId: string) {
  return {
    result: "claimed" as const,
    deliveryId,
    ownerGeneration: 7,
    joinToken: `chj_token_${deliveryId.slice(4)}`,
    joinTokenExpiresAt: "2099-07-29T16:01:00.000Z",
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
  };
}

function invitation(deliveryId: string) {
  return {
    protocol: "channel_delivery_v1" as const,
    deliveryId,
    canonicalThreadId: SHARED_THREAD_ID,
    channelName: "support",
    adapter: "slack" as const,
  };
}

/** Attach an application author to an otherwise ordinary text delivery. */
function authoredDelivery(
  suffix: string,
  authoredBy: unknown = AUTHORED_BY,
): PreparedChannelDelivery {
  const base = preparedDelivery(suffix, "slack", {
    kind: "text",
    text: "follow-up from the web",
  });
  return {
    ...base,
    turn: { ...base.turn, authoredBy: authoredBy as ChannelAuthoredActor },
  };
}

test("an application-authored turn reaches the handler as attribution, not as a provider actor", async () => {
  const observed: {
    authoredBy?: ChannelAuthoredActor;
    actorId?: string;
    actorKind?: string;
    text?: string;
  } = {};
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    identifyUser: () => ({ id: "person-1", name: "Ada App" }),
    name: "support",
  });
  channel.onMessage(({ message }) => {
    observed.authoredBy = message.authoredBy;
    observed.actorId = message.actor.id;
    observed.actorKind = message.actor.kind;
    observed.text = message.text;
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_authored_actor",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(authoredDelivery("authoredActor"));
  } finally {
    await handle.stop();
  }

  expect(observed.authoredBy).toEqual(AUTHORED_BY);
  expect(observed.text).toBe("follow-up from the web");
  // The provider actor is preserved exactly. A web-composed message must never
  // be laundered into "the Slack user said this" — the author is additive.
  expect(observed.actorKind).toBe("human");
  expect(observed.actorId).toBe("user_authoredActor");
});

test("a provider-authored turn carries no application author", async () => {
  let authoredBy: ChannelAuthoredActor | undefined | "unset" = "unset";
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    identifyUser: () => ({ id: "person-1", name: "Ada App" }),
    name: "support",
  });
  channel.onMessage(({ message }) => {
    authoredBy = message.authoredBy;
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_provider_actor",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("providerAuthored", "slack", {
        kind: "text",
        text: "hello from Slack",
      }),
    );
  } finally {
    await handle.stop();
  }

  // Absence is the signal a handler switches on, so it must be a real
  // `undefined` rather than a defaulted empty object.
  expect(authoredBy).toBeUndefined();
});

test.each([
  ["an unknown author class", { ...AUTHORED_BY, kind: "provider" }],
  ["an unexpected extra field", { ...AUTHORED_BY, escalate: true }],
  ["a missing display name", { ...AUTHORED_BY, displayName: undefined }],
  ["a blank display name", { ...AUTHORED_BY, displayName: "   " }],
  [
    "an unsafe application user id",
    { ...AUTHORED_BY, appUserId: "../../root" },
  ],
  ["a non-string surface", { ...AUTHORED_BY, surface: 7 }],
])("the join boundary refuses %s", async (_label, authoredBy) => {
  const observed: ChannelAuthoredActor[] = [];
  const gateway = new DeliveryTestGateway();
  const channel = createChannel({
    identifyUser: () => ({ id: "person-1", name: "Ada App" }),
    name: "support",
  });
  channel.onMessage(({ message }) => {
    if (message.authoredBy) observed.push(message.authoredBy);
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_authored_reject",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    await gateway
      .deliver(authoredDelivery("authoredReject", authoredBy))
      .catch(() => undefined);
  } finally {
    await handle.stop();
  }

  // A malformed author must not reach a handler at all. Rendering an
  // unvalidated name as attribution is precisely the impersonation this
  // boundary exists to prevent, so a partial accept is worse than a refusal.
  expect(observed).toEqual([]);
});

/**
 * Same-thread ordering has to be exercised at the transport, not through
 * {@link DeliveryTestGateway}: that helper holds one prepared delivery at a
 * time and waits for its topic to close, so two turns published through it are
 * sequential by construction and would prove nothing. Driving the transport
 * directly lets the second invitation genuinely arrive while the first turn is
 * still running.
 *
 * What this pins is that an application-authored delivery is chained onto the
 * same `threadTails` predecessor as a provider delivery. Capacity is left with
 * headroom on purpose so a local concurrency ceiling cannot be what orders the
 * two turns; if application turns were ever exempted from that chain, the two
 * handlers would overlap and the interleaving below would change.
 */
test("an application turn waits for the provider turn already running on its thread", async () => {
  const order: string[] = [];
  let releaseProvider: (() => void) | undefined;
  const providerDone = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const control: RealtimeGatewaySession = {
    push: vi
      .fn()
      .mockImplementation((_event, payload) =>
        Promise.resolve(
          claimResult((payload as { deliveryId: string }).deliveryId),
        ),
      ),
    on: vi.fn(),
    join: vi.fn().mockImplementation((topic: string) => {
      const deliveryId = topic.replace("delivery:", "");
      const base = preparedDelivery(deliveryId.slice("dlv_".length), "slack", {
        kind: "text",
        text: "hello",
      });
      return Promise.resolve(
        deliveryChannel({
          ...base,
          deliveryId,
          canonicalThreadId: SHARED_THREAD_ID,
          ...(deliveryId === APPLICATION_DELIVERY_ID
            ? { turn: { ...base.turn, authoredBy: AUTHORED_BY } }
            : {}),
        }),
      );
    }),
  };
  const transport = new ChannelDeliveryTransport({
    session: control,
    runtimeInstanceId: "rti_authored_fifo",
    // Headroom on purpose: with a ceiling of 1 this test would pass because the
    // replica ran out of slots, not because the two turns share a thread.
    maxConcurrentDeliveries: 4,
  });
  transport.start(async (_claimed, delivery) => {
    const label = delivery.turn.authoredBy ? "application" : "provider";
    order.push(`start:${label}`);
    if (delivery.deliveryId === PROVIDER_DELIVERY_ID) await providerDone;
    order.push(`end:${label}`);
  });
  const invite = vi.mocked(control.on).mock.calls[0]![1];

  invite(invitation(PROVIDER_DELIVERY_ID));
  await vi.waitFor(() => expect(order).toEqual(["start:provider"]));

  // Arrives while the provider turn is still inside its handler.
  invite(invitation(APPLICATION_DELIVERY_ID));
  await vi.waitFor(() =>
    expect(control.push).toHaveBeenCalledWith(
      "claim",
      expect.objectContaining({ deliveryId: APPLICATION_DELIVERY_ID }),
    ),
  );
  // Claiming is only the first hop; joining the topic and entering the handler
  // are further awaits. Drain the queues so the application turn has a real
  // opportunity to start — asserting straight after the claim would pass even
  // if nothing were serialising these two turns.
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // Given that opportunity, it still must not have run behind the live turn.
  expect(order).toEqual(["start:provider"]);

  releaseProvider?.();
  await vi.waitFor(() =>
    expect(order).toEqual([
      "start:provider",
      "end:provider",
      "start:application",
      "end:application",
    ]),
  );
  await transport.stop();
});
