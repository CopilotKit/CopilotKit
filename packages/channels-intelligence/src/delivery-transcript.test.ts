import { expect, test, vi } from "vitest";
import { FakeAgent } from "@copilotkit/channels-core";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ClaimedChannelDelivery } from "./delivery-transport.js";
import type { PreparedChannelDelivery } from "./delivery-transport.js";
import { ChannelDeliveryTranscriptClient } from "./delivery-transcript.js";
import type { ChannelDeliveryTranscriptError } from "./delivery-transcript.js";

const transcript = {
  messages: [
    {
      logicalMessageId: "1730000000.000100",
      revisionId: "1730000000.000100",
      occurredAt: "2026-07-30T20:00:00.000Z",
      role: "participant" as const,
      actor: {
        id: "U1",
        kind: "human" as const,
        displayName: "Ada",
        handle: "ada",
      },
      text: "hello",
      deleted: false,
      currentTrigger: true,
      files: [],
    },
  ],
  truncation: {
    messageLimit: false,
    byteLimit: false,
    omittedMessageCount: 0,
  },
};

test("transcript client calls the delivery-scoped route with runtime auth", async () => {
  const fetch = vi.fn(async () =>
    Promise.resolve(new Response(JSON.stringify(transcript))),
  );
  const client = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example/",
    apiKey: "cpk-runtime",
    fetch,
  });

  await expect(client.fetchTranscript("dlv_123")).resolves.toEqual(transcript);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "https://api.example/api/channels/deliveries/dlv_123/transcript",
    {
      method: "GET",
      headers: { authorization: "Bearer cpk-runtime" },
    },
  );
});

test("transcript client makes three total attempts for retryable failures", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "CHANNEL_TRANSCRIPT_RETRYABLE", retryable: true },
        }),
        { status: 503 },
      ),
    )
    .mockRejectedValueOnce(new Error("network unavailable"))
    .mockResolvedValueOnce(new Response(JSON.stringify(transcript)));
  const client = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });

  await expect(client.fetchTranscript("dlv_123")).resolves.toEqual(transcript);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("transcript client does not retry permanent failures", async () => {
  const fetch = vi.fn(async () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: "CHANNEL_TRANSCRIPT_UNAVAILABLE", retryable: false },
        }),
        { status: 422 },
      ),
    ),
  );
  const client = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });

  await expect(client.fetchTranscript("dlv_123")).rejects.toMatchObject({
    name: "ChannelDeliveryTranscriptError",
    code: "CHANNEL_TRANSCRIPT_UNAVAILABLE",
    retryable: false,
    attempts: 1,
  } satisfies Partial<ChannelDeliveryTranscriptError>);
  expect(fetch).toHaveBeenCalledOnce();
});

test("transcript client rejects malformed successful responses without another provider attempt", async () => {
  const fetch = vi.fn(async () =>
    Promise.resolve(new Response(JSON.stringify({ messages: "raw Slack" }))),
  );
  const client = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });

  await expect(client.fetchTranscript("dlv_123")).rejects.toMatchObject({
    code: "CHANNEL_TRANSCRIPT_RESPONSE_INVALID",
    retryable: false,
    attempts: 1,
  });
  expect(fetch).toHaveBeenCalledOnce();
});

test("one claimed delivery shares its transcript promise across getMessages and runAgent history", async () => {
  const fetch = vi.fn(async () =>
    Promise.resolve(new Response(JSON.stringify(transcript))),
  );
  const transcriptClient = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });
  const delivery: PreparedChannelDelivery = {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_transcript_01",
    deliveryExpiresAt: "2099-07-30T20:00:00.000Z",
    canonicalThreadId: "thread_transcript",
    appUserId: "slack:T1:U1",
    channelId: "channel_transcript",
    channelName: "support",
    adapter: "slack",
    turn: {
      eventId: "evt_transcript",
      receivedAt: "2026-07-30T20:00:00.000Z",
      input: {
        kind: "text",
        text: "hello",
        operation: {
          kind: "created",
          logicalMessageId: "1730000000.000100",
          revisionId: "1730000000.000100",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1", kind: "human", displayName: "Ada" },
    },
  };
  const claimed = new ClaimedChannelDelivery(
    delivery,
    { ownerGeneration: 1, runtimeInstanceId: "rti_transcript_01" },
    {
      joinReply: delivery,
      push: vi.fn(),
      on: vi.fn(),
      onClose: vi.fn(),
      leave: vi.fn(),
    },
    vi.fn(),
    undefined,
    transcriptClient,
  );
  const persistedRuns: unknown[][] = [];
  const loadHistory = vi.fn(async () => []);
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport: {} as never,
    loadHistory,
    runCanonical: async (args) => {
      persistedRuns.push(args.persistedInputMessages);
      return { iterations: 0, interrupted: false };
    },
  });
  const target = { claimedDelivery: claimed, delivery };

  await expect(adapter.getMessages(target)).resolves.toEqual([
    expect.objectContaining({
      text: "hello",
      user: {
        id: "U1",
        kind: "human",
        name: "Ada",
        handle: "ada",
      },
      providerMessage: expect.objectContaining({
        currentTrigger: true,
        logicalMessageId: "1730000000.000100",
      }),
    }),
  ]);
  const first = await adapter.conversationStore.getOrCreate(
    delivery.canonicalThreadId,
    target,
    () => new FakeAgent(),
  );
  expect(first.agent.messages).toHaveLength(1);
  expect(String(first.agent.messages[0]?.content)).toContain(
    "untrusted content",
  );
  await adapter.runAgentLifecycle({
    replyTarget: target,
    agent: first.agent,
    renderer: {} as never,
    tools: [],
    context: [],
    execute: vi.fn(),
  });
  first.release?.();

  expect(persistedRuns[0]).toHaveLength(1);
  expect(fetch).toHaveBeenCalledOnce();
  expect(loadHistory).not.toHaveBeenCalled();

  const second = await adapter.conversationStore.getOrCreate(
    delivery.canonicalThreadId,
    target,
    () => new FakeAgent(),
  );
  await adapter.runAgentLifecycle({
    replyTarget: target,
    agent: second.agent,
    renderer: {} as never,
    tools: [],
    context: [],
    execute: vi.fn(),
  });
  second.release?.();

  expect(persistedRuns[1]).toHaveLength(0);
  expect(fetch).toHaveBeenCalledOnce();
});
