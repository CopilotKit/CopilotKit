import { expect, test, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { of } from "rxjs";
import { DeliveryAdapter } from "./delivery-adapter.js";
import { ChannelDeliveryFileClient } from "./delivery-files.js";
import { ClaimedChannelDelivery } from "./delivery-transport.js";
import type { ChannelDeliveryTransport } from "./delivery-transport.js";
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

class CapturingAgent extends AbstractAgent {
  constructor(private readonly capturedInputs: RunAgentInput[]) {
    super({ agentId: "capturing" });
  }

  run(input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    this.capturedInputs.push(structuredClone(input));
    return of(
      {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    );
  }

  override clone(): CapturingAgent {
    const cloned = new CapturingAgent(this.capturedInputs);
    cloned.threadId = this.threadId;
    cloned.agentId = this.agentId;
    cloned.messages = structuredClone(this.messages);
    cloned.state = structuredClone(this.state);
    return cloned;
  }
}

test("managed inbound image reaches the agent through transcript-seeded runAgent", async () => {
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageBase64 = Buffer.from(imageBytes).toString("base64");
  const imageHandle = "fileref_transcript_image";
  const imageTranscript = {
    ...transcript,
    messages: [
      {
        ...transcript.messages[0]!,
        text: "This image",
        files: [
          {
            providerFileId: `managed:${imageHandle}`,
            name: "image.png",
            mimeType: "image/png",
            byteSize: imageBytes.byteLength,
            availability: "managed" as const,
            handle: imageHandle,
          },
        ],
      },
    ],
  };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith(`/api/channels/files/${imageHandle}`)) {
      return new Response(imageBytes, {
        headers: { "content-type": "image/png" },
      });
    }
    if (
      url.endsWith("/api/channels/deliveries/dlv_transcript_image/transcript")
    ) {
      return new Response(JSON.stringify(imageTranscript));
    }
    throw new Error(`unexpected URL: ${url}`);
  });
  const fileClient = new ChannelDeliveryFileClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });
  const transcriptClient = new ChannelDeliveryTranscriptClient({
    baseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    fetch,
  });
  const delivery: PreparedChannelDelivery = {
    protocol: "channel_delivery_v1",
    deliveryId: "dlv_transcript_image",
    deliveryExpiresAt: "2099-07-30T20:00:00.000Z",
    canonicalThreadId: "thread_transcript_image",
    appUserId: "slack:T1:U1",
    channelId: "channel_transcript_image",
    channelName: "support",
    adapter: "slack",
    turn: {
      eventId: "evt_transcript_image",
      receivedAt: "2026-07-30T20:00:00.000Z",
      input: {
        kind: "text",
        text: "This image",
        files: [
          {
            handle: imageHandle,
            filename: "image.png",
            mimeType: "image/png",
            byteSize: imageBytes.byteLength,
          },
        ],
        operation: {
          kind: "created",
          logicalMessageId: "1730000000.000100",
          revisionId: "1730000000.000100",
          mentioned: true,
        },
      },
      actor: { externalUserId: "U1", kind: "human", displayName: "Ada" },
    },
  };
  const claimed = new ClaimedChannelDelivery(
    delivery,
    { ownerGeneration: 1, runtimeInstanceId: "rti_transcript_image" },
    {
      joinReply: delivery,
      push: vi.fn(),
      on: vi.fn(),
      onClose: vi.fn(),
      leave: vi.fn(),
    },
    vi.fn(),
    fileClient,
    transcriptClient,
  );
  let handleDelivery:
    | ((
        claimedDelivery: ClaimedChannelDelivery,
        preparedDelivery: PreparedChannelDelivery,
      ) => Promise<void>)
    | undefined;
  const transport = {
    start: vi.fn((handler) => {
      handleDelivery = handler;
    }),
    stop: vi.fn(async () => undefined),
  } as unknown as ChannelDeliveryTransport;
  const capturedInputs: RunAgentInput[] = [];
  const adapter = new DeliveryAdapter({
    channelName: "support",
    transport,
    loadHistory: async () => [],
    runCanonical: async (args) => args.execute({}),
  });
  const channel = createChannel({
    name: "support",
    adapters: [adapter],
    agent: () => new CapturingAgent(capturedInputs),
  });
  channel.onMention(async ({ thread, message }) => {
    await thread.runAgent({
      prompt: message.contentParts?.length
        ? message.contentParts
        : message.text,
    });
  });

  await channel.ɵruntime.start();
  expect(handleDelivery).toBeDefined();
  await handleDelivery!(claimed, delivery);
  await channel.ɵruntime.stop();

  expect(capturedInputs).toHaveLength(1);
  expect(capturedInputs[0]?.messages).toEqual([
    expect.objectContaining({
      role: "user",
      content: [
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("This image"),
        }),
        {
          type: "image",
          source: {
            type: "data",
            value: imageBase64,
            mimeType: "image/png",
          },
        },
      ],
    }),
  ]);
  expect(fetch).toHaveBeenCalledWith(
    `https://api.example/api/channels/files/${imageHandle}`,
    expect.objectContaining({ method: "GET" }),
  );
});
