import { createChannel } from "@copilotkit/channels-core";
import type { ChannelIdentityContext } from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

type IdentityCase = {
  name: string;
  appUserId: string;
  tenant?: PreparedChannelDelivery["tenant"];
  adapter?: "slack" | "teams";
  actorId?: string;
  actorKind?: NonNullable<PreparedChannelDelivery["turn"]["actor"]>["kind"];
  missingActor?: boolean;
  expectedTenant: string;
};

const cases: IdentityCase[] = [
  {
    name: "Slack-shaped custom ID without tenant provenance",
    appUserId: "slack:T123:U123",
    expectedTenant: "unknown",
  },
  {
    name: "Slack W identity without tenant provenance",
    appUserId: "slack:T123:W123",
    actorId: "W123",
    expectedTenant: "unknown",
  },
  {
    name: "another workspace",
    appUserId: "slack:T999:U123",
    expectedTenant: "unknown",
  },
  {
    name: "another user",
    appUserId: "slack:T123:U999",
    actorId: "U999",
    expectedTenant: "unknown",
  },
  {
    name: "trusted owner workspace with a custom application user",
    appUserId: "application-owner",
    tenant: { id: "T123", name: "Trusted workspace" },
    expectedTenant: "T123",
  },
  {
    name: "trusted owner workspace with a conflicting encoded workspace",
    appUserId: "slack:T999:U123",
    tenant: { id: "T123" },
    expectedTenant: "T123",
  },
  {
    name: "trusted workspace with an unlinked actor",
    appUserId: "application-owner",
    tenant: { id: "T123" },
    actorId: "U999",
    expectedTenant: "T123",
  },
  {
    name: "explicit tenant",
    appUserId: "slack:T123:U123",
    tenant: { id: "T999", name: "Explicit" },
    expectedTenant: "T999",
  },
  {
    name: "explicit unknown tenant",
    appUserId: "slack:T123:U123",
    tenant: { id: "unknown" },
    expectedTenant: "unknown",
  },
  {
    name: "custom application user",
    appUserId: "application-owner",
    expectedTenant: "unknown",
  },
  {
    name: "mismatched actor",
    appUserId: "slack:T123:U999",
    expectedTenant: "unknown",
  },
  {
    name: "missing actor",
    appUserId: "slack:T123:U123",
    missingActor: true,
    expectedTenant: "unknown",
  },
  {
    name: "bot actor",
    appUserId: "slack:T123:U123",
    actorKind: "bot",
    expectedTenant: "unknown",
  },
  {
    name: "app actor",
    appUserId: "slack:T123:U123",
    actorKind: "app",
    expectedTenant: "unknown",
  },
  {
    name: "system actor",
    appUserId: "slack:T123:U123",
    actorKind: "system",
    expectedTenant: "unknown",
  },
  {
    name: "unknown actor",
    appUserId: "slack:T123:U123",
    actorKind: "unknown",
    expectedTenant: "unknown",
  },
  {
    name: "Teams delivery",
    appUserId: "slack:T123:U123",
    adapter: "teams",
    expectedTenant: "unknown",
  },
  {
    name: "wrong namespace",
    appUserId: "teams:T123:U123",
    expectedTenant: "unknown",
  },
  {
    name: "extra segment",
    appUserId: "slack:T123:U123:extra",
    expectedTenant: "unknown",
  },
  {
    name: "missing workspace",
    appUserId: "slack::U123",
    expectedTenant: "unknown",
  },
  {
    name: "invalid workspace",
    appUserId: "slack:not-a-team:U123",
    expectedTenant: "unknown",
  },
  {
    name: "invalid user",
    appUserId: "slack:T123:B123",
    actorId: "B123",
    expectedTenant: "unknown",
  },
];

test.each(cases)("managed identifyUser receives $name", async (identity) => {
  const gateway = new DeliveryTestGateway();
  const identifyUser = vi.fn((context: ChannelIdentityContext) =>
    context.provider === "slack" &&
    context.tenant.id === "T123" &&
    context.actor.kind === "human" &&
    context.actor.id === "U123"
      ? { id: "owner", name: "Owner" }
      : null,
  );
  const channel = createChannel({ name: "support", identifyUser });
  const onMention = vi.fn<Parameters<typeof channel.onMention>[0]>(
    async ({ message, thread }) => {
      if (message.user?.id === "owner")
        await thread.post("Allowed owner reply");
    },
  );
  channel.onMention(onMention);
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_delivery_identity",
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });

  try {
    const delivery = preparedDelivery("identity", identity.adapter ?? "slack", {
      kind: "text",
      text: "@bot hello",
    });
    delivery.appUserId = identity.appUserId;
    delete delivery.tenant;
    delete delivery.installation;
    delete delivery.conversation;
    delete delivery.turn.raw;
    if (identity.tenant) delivery.tenant = identity.tenant;
    delivery.turn.actor = identity.missingActor
      ? undefined
      : {
          externalUserId: identity.actorId ?? "U123",
          kind: identity.actorKind ?? "human",
        };
    if (delivery.turn.input.kind !== "text")
      throw new Error("Expected text fixture");
    delivery.turn.input.operation.mentioned = true;
    await gateway.deliver(delivery);

    expect(identifyUser).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        provider: identity.adapter ?? "slack",
        tenant: identity.tenant ?? { id: identity.expectedTenant },
      }),
    );
    const allowed =
      (identity.adapter ?? "slack") === "slack" &&
      identity.expectedTenant === "T123" &&
      !identity.missingActor &&
      (identity.actorKind ?? "human") === "human" &&
      (identity.actorId ?? "U123") === "U123";
    expect(onMention).toHaveBeenCalledOnce();
    expect(onMention.mock.calls[0]?.[0].message.user?.id ?? null).toBe(
      allowed ? "owner" : null,
    );
    expect(
      gateway.packets.filter(
        (packet) =>
          packet.payload.kind === "slack.message.create" &&
          packet.payload.text === "Allowed owner reply",
      ),
    ).toHaveLength(allowed ? 1 : 0);
  } finally {
    await handle.stop();
  }
});
