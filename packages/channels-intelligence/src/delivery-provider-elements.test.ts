import { expect, test, vi } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { Slack } from "@copilotkit/channels-slack";
import { Teams } from "@copilotkit/channels-teams";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ChannelProviderMismatchError } from "./delivery-transport.js";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";

function delivery(adapter: "slack" | "teams"): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId: `dlv_provider_element_${adapter}`,
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_provider_element",
    channelName: "support",
    surfaceId: "surface_support_01",
    canonicalThreadId: "thread_provider_element",
    appUserId: `${adapter}:tenant:user`,
    adapter,
    turn: {
      eventId: `evt_provider_element_${adapter}`,
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        messageRef: { id: "pref_v1_provider_element_message_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: true,
        },
      },
      actor: { externalUserId: "user", kind: "human" },
    },
  };
}

function makeAdapter(): DeliveryAdapter {
  return new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => [],
  });
}

function target(provider: "slack" | "teams", effect: ReturnType<typeof vi.fn>) {
  return {
    claimedDelivery: { effect } as unknown as ClaimedChannelDelivery,
    delivery: delivery(provider),
  };
}

test.each([
  ["slack", "teams"],
  ["teams", "slack"],
] as const)(
  "%s delivery rejects a %s-native element before an effect is sent",
  async (activeProvider, elementProvider) => {
    const effect = vi.fn();
    const ir: ChannelNode[] = [
      {
        type: "raw",
        props: {
          provider: elementProvider,
          value:
            elementProvider === "teams"
              ? { type: "AdaptiveCard", version: "1.5", body: [] }
              : [{ type: "section", text: { type: "plain_text", text: "hi" } }],
        },
      },
    ];

    await expect(
      makeAdapter().post(target(activeProvider, effect), ir),
    ).rejects.toBeInstanceOf(ChannelProviderMismatchError);
    expect(effect).not.toHaveBeenCalled();
  },
);

test("Teams delivery forwards a Teams-native Adaptive Card without translation", async () => {
  const card = { type: "AdaptiveCard", version: "1.5", body: [] };
  const effect = vi.fn().mockResolvedValue({
    providerReference: "pref_v1_teams_native_card_123",
    providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  });

  await makeAdapter().post(target("teams", effect), [
    { type: "raw", props: { provider: "teams", value: card } },
  ]);

  expect(effect).toHaveBeenCalledWith(expect.any(String), {
    kind: "teams.message.create",
    text: "",
    cards: [card],
  });
});

test("managed Slack delivery serializes native JSX with fallback text", async () => {
  const effect = vi.fn().mockResolvedValue({
    providerReference: "pref_v1_slack_native_jsx_123",
    providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  });
  const ir = [
    Slack.Block.Section({
      text: Slack.Object.MarkdownText({ text: "*Deploy ready*" }),
    }),
  ];

  await makeAdapter().post(target("slack", effect), ir);

  expect(effect).toHaveBeenCalledWith(expect.any(String), {
    kind: "slack.message.create",
    text: "Deploy ready",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Deploy ready*" },
      },
    ],
  });
});

test("managed Slack delivery preserves a data visualization chart", async () => {
  const effect = vi.fn().mockResolvedValue({
    providerReference: "pref_v1_slack_data_visualization_123",
    providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  });
  const chart = {
    type: "line" as const,
    series: [
      {
        name: "Temperature",
        data: [
          { label: "Mon", value: 62 },
          { label: "Tue", value: 65 },
        ],
      },
    ],
    axis_config: {
      categories: ["Mon", "Tue"],
      y_label: "Temperature (F)",
    },
  };

  await makeAdapter().post(target("slack", effect), [
    Slack.Block.DataVisualization({
      title: "San Francisco forecast",
      chart,
    }),
  ]);

  expect(effect).toHaveBeenCalledWith(expect.any(String), {
    kind: "slack.message.create",
    text: "San Francisco forecast",
    blocks: [
      {
        type: "data_visualization",
        title: "San Francisco forecast",
        chart,
      },
    ],
  });
});

test("managed Teams delivery serializes the native Adaptive Card root", async () => {
  const effect = vi.fn().mockResolvedValue({
    providerReference: "pref_v1_teams_native_jsx_123",
    providerMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  });
  const ir = [
    Teams.AdaptiveCard({
      fallbackText: "Deploy approval",
      children: Teams.TextBlock({ text: "Deploy ready", wrap: true }),
    }),
  ];

  await makeAdapter().post(target("teams", effect), ir);

  expect(effect).toHaveBeenCalledWith(expect.any(String), {
    kind: "teams.message.create",
    text: "",
    cards: [
      {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.2",
        fallbackText: "Deploy approval",
        body: [{ type: "TextBlock", text: "Deploy ready", wrap: true }],
      },
    ],
  });
});
