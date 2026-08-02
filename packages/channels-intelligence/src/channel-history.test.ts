import { expect, test, vi } from "vitest";
import { ChannelHistoryHttpClient } from "./channel-history.js";

test("history client sends only trusted surface scope to App API", async () => {
  const page = {
    messages: [
      {
        id: "chmsg_123",
        occurredAt: "2026-08-01T10:00:00.000Z",
        actor: { id: "U123", kind: "human" as const },
        text: "Earlier message",
        position: "root" as const,
      },
    ],
    nextCursor: "opaque-next",
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
  const client = new ChannelHistoryHttpClient({
    baseUrl: "https://api.example/",
    apiKey: "cpk-runtime",
    channelName: "support",
    fetch,
  });

  await expect(
    client.read(
      {
        surfaceId: "surface_model_spoof",
        limit: 25,
        cursor: "opaque-current",
      },
      {
        replyTarget: {
          delivery: {
            deliveryId: "dlv_delivery_01",
            surfaceId: "surface_support_01",
          },
        },
      },
    ),
  ).resolves.toEqual(page);

  expect(fetch).toHaveBeenCalledWith(
    "https://api.example/api/channels/support/messages?surfaceId=surface_support_01&limit=25&cursor=opaque-current",
    {
      method: "GET",
      headers: {
        authorization: "Bearer cpk-runtime",
        "x-cpki-channel-delivery-id": "dlv_delivery_01",
      },
    },
  );
});
