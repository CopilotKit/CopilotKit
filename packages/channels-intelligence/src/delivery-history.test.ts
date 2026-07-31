import { AbstractAgent } from "@ag-ui/client";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { expect, test, vi } from "vitest";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type { ClaimedChannelDelivery } from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";

const delivery: PreparedChannelDelivery = {
  protocol: "channel_delivery_v1",
  deliveryId: "dlv_history_01",
  deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
  channelId: "channel_history_01",
  channelName: "support",
  canonicalThreadId: "thread_history",
  appUserId: "slack:T1:U1",
  adapter: "slack",
  turn: {
    eventId: "evt_history",
    receivedAt: "2026-07-29T17:00:00.000Z",
    input: {
      kind: "text",
      text: "hi",
      operation: {
        kind: "created",
        logicalMessageId: "message-history",
        revisionId: "revision-history",
        mentioned: false,
      },
    },
    actor: { externalUserId: "U1" },
  },
};

test("managed history keeps multimodal and activity content structured", async () => {
  const imageContent = [
    { type: "text", text: "What is this?" },
    {
      type: "image",
      source: {
        type: "data",
        value: "iVBORw0KGgo=",
        mimeType: "image/png",
      },
    },
  ];
  const activityContent = {
    assetId: "fileref_chart",
    filename: "chart.png",
    mimeType: "image/png",
    byteSize: 8,
    altText: "Chart",
  };
  const history = [
    { id: "user-image", role: "user", content: imageContent },
    {
      id: "asset-activity",
      role: "activity",
      activityType: "copilotkit.managed-asset",
      content: activityContent,
    },
  ] as Message[];
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory: async () => history,
  });

  const specializedTarget = {
    claimedDelivery: {} as ClaimedChannelDelivery,
    delivery: {
      ...delivery,
      turn: {
        ...delivery.turn,
        input: { kind: "command" as const, command: "history" },
      },
    },
  };

  await expect(adapter.getMessages(specializedTarget)).resolves.toEqual([
    expect.objectContaining({
      text: "What is this?",
      content: imageContent,
    }),
    expect.objectContaining({
      text: "",
      activityType: "copilotkit.managed-asset",
      content: activityContent,
    }),
  ]);
});

class NoopAgent extends AbstractAgent {
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

test("canonical run input stores managed asset references instead of hydrated bytes", async () => {
  const withFile: PreparedChannelDelivery = {
    ...delivery,
    turn: {
      ...delivery.turn,
      input: {
        kind: "text",
        text: "What is this?",
        operation: {
          kind: "created",
          logicalMessageId: "message-history-file",
          revisionId: "revision-history-file",
          mentioned: false,
        },
        files: [
          {
            handle: "fileref_inbound",
            filename: "photo.png",
            mimeType: "image/png",
            byteSize: 8,
          },
        ],
      },
    },
  };
  let persisted: Message[] = [];
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    loadHistory: async () => [],
    runCanonical: async (args) => {
      persisted = args.persistedInputMessages;
      return { iterations: 0, interrupted: false };
    },
  });
  const agent = new NoopAgent({
    initialMessages: [
      {
        id: "user-inbound",
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            source: {
              type: "data",
              value: "iVBORw0KGgo=",
              mimeType: "image/png",
            },
          },
        ],
      },
    ],
  });

  await adapter.runAgentLifecycle({
    replyTarget: {
      claimedDelivery: {} as ClaimedChannelDelivery,
      delivery: withFile,
    },
    agent,
    renderer: {} as never,
    tools: [],
    context: [],
    execute: vi.fn(),
  });

  expect(JSON.stringify(persisted)).not.toContain("iVBOR");
  expect(persisted[0]?.content).toEqual([
    { type: "text", text: "What is this?" },
    {
      type: "image",
      source: {
        type: "url",
        value: "cpki-asset://fileref_inbound",
        mimeType: "image/png",
      },
      metadata: {
        managedAsset: {
          id: "fileref_inbound",
          filename: "photo.png",
          mimeType: "image/png",
          byteSize: 8,
        },
      },
    },
  ]);
});
