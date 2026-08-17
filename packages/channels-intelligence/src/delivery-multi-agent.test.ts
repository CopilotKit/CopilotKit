import {
  createChannel,
  FakeAgent,
  MemoryStore,
} from "@copilotkit/channels-core";
import { expect, test, vi } from "vitest";
import {
  DeliveryTestGateway,
  preparedDelivery,
} from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

function appApiFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    if (String(input).endsWith("/charge")) {
      return new Response(JSON.stringify({ charged: true }));
    }
    return new Response(
      JSON.stringify({
        messages: [
          {
            logicalMessageId:
              "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
            revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
            occurredAt: "2026-07-29T17:00:00.000Z",
            role: "participant",
            actor: {
              id: "U1",
              kind: "human",
              displayName: null,
              handle: null,
            },
            text: "hello",
            messageRef: {
              id: "pref_v1_transcript_message_multi_agent_123",
            },
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
      }),
    );
  }) as unknown as typeof globalThis.fetch;
}

const textTurn = {
  kind: "text" as const,
  text: "hello",
  operation: {
    kind: "created" as const,
    logicalMessageId: "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
    mentioned: false,
  },
};

test("extra agents send prefixed canonical agentId and unsuffixed history thread", async () => {
  const gateway = new DeliveryTestGateway();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    agent: () => new FakeAgent(),
    agents: { billing: () => new FakeAgent() },
    store: { adapter: new MemoryStore() },
  });
  channel.onMessage(async ({ thread, message }) => {
    await thread.runAgent({
      agentId: "billing",
      prompt: message.text,
      memory: { user: "read", project: "read-write" },
    });
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_multi_agent",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch: appApiFetch(),
    runCanonical,
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(preparedDelivery("multiagent", "slack", textTurn));

    expect(runCanonical).toHaveBeenCalledOnce();
    expect(runCanonical.mock.calls[0]![0].agentId).toBe("support:billing");
    expect(runCanonical.mock.calls[0]![0].agent.threadId).toMatch(/::billing$/);
    expect(runCanonical.mock.calls[0]![0].threadId).not.toContain("::billing");
    expect(String(runCanonical.mock.calls[0]![0].threadId)).toContain("thread_");
  } finally {
    await handle.stop();
  }
});

test("default agent keeps the Channel name as agentId", async () => {
  const gateway = new DeliveryTestGateway();
  const runCanonical = vi.fn(async (args) => args.execute({}));
  const channel = createChannel({
    identifyUser: "platform",
    name: "support",
    agent: () => new FakeAgent(),
    agents: { billing: () => new FakeAgent() },
    store: { adapter: new MemoryStore() },
  });
  channel.onMessage(async ({ thread, message }) => {
    await thread.runAgent({
      prompt: message.text,
      memory: { user: "read", project: "read-write" },
    });
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId: "rti_multi_default",
    appApiBaseUrl: "https://api.example",
    apiKey: "cpk-runtime",
    appApiFetch: appApiFetch(),
    runCanonical,
    loadHistory: async () => [],
  });

  try {
    await gateway.deliver(
      preparedDelivery("multidefault", "slack", textTurn),
    );

    expect(runCanonical).toHaveBeenCalledOnce();
    expect(runCanonical.mock.calls[0]![0].agentId).toBe("support");
    expect(runCanonical.mock.calls[0]![0].agent.threadId).not.toMatch(/::/);
  } finally {
    await handle.stop();
  }
});
