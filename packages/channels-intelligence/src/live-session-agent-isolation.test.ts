import { expect, test, vi } from "vitest";
import { FakeAgent } from "@copilotkit/channels-core";
import type { Message } from "@ag-ui/client";
import { LiveSessionAdapter } from "./live-session-adapter.js";
import { LiveSessionTransport } from "./live-session-transport.js";
import type {
  LiveDeliverySession,
  LiveSessionDelivery,
} from "./live-session-transport.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";

const delivery = (
  deliveryId: string,
  canonicalThreadId: string,
): LiveSessionDelivery => ({
  protocol: "channel_session_v1",
  deliveryId,
  deliveryCode: `dcode_${deliveryId}`,
  sessionTopic: `channel_session:${deliveryId}`,
  canonicalThreadId,
  appUserId: `user_${canonicalThreadId}`,
  channelId: "channel_agent_isolation",
  adapter: "slack",
  turn: {
    id: `turn_${deliveryId}`,
    eventId: `event_${deliveryId}`,
    receivedAt: "2026-07-29T00:00:00.000Z",
    input: { kind: "text", text: "hello" },
  },
});

const target = (value: LiveSessionDelivery) => ({
  delivery: value,
  session: {} as LiveDeliverySession,
});

test("one configured agent instance serializes managed histories across canonical threads", async () => {
  const sharedAgent = new FakeAgent();
  const histories = new Map<string, Message[]>([
    [
      "thread_one",
      [{ id: "message_one", role: "user", content: "one" } as Message],
    ],
    [
      "thread_two",
      [{ id: "message_two", role: "user", content: "two" } as Message],
    ],
  ]);
  const loadHistory = vi.fn(
    async ({ threadId }: { threadId: string; appUserId: string }) =>
      histories.get(threadId) ?? [],
  );
  const gatewaySession: RealtimeGatewaySession = {
    push: vi.fn(),
    on: vi.fn(),
  };
  const adapter = new LiveSessionAdapter({
    transport: new LiveSessionTransport({
      session: gatewaySession,
      runtimeInstanceId: "runtime_agent_isolation",
    }),
    runCanonical: async () => ({ iterations: 0, interrupted: false }),
    loadHistory,
  });

  const first = await adapter.conversationStore.getOrCreate(
    "thread_one",
    target(delivery("delivery_one", "thread_one")),
    () => sharedAgent,
  );
  const secondPromise = adapter.conversationStore.getOrCreate(
    "thread_two",
    target(delivery("delivery_two", "thread_two")),
    () => sharedAgent,
  );
  await Promise.resolve();

  expect(loadHistory).toHaveBeenCalledTimes(1);
  expect(first.agent.messages.map(({ id }) => id)).toEqual(["message_one"]);
  const release = (
    first as typeof first & { release?: () => void | Promise<void> }
  ).release;
  expect(release).toEqual(expect.any(Function));

  await release?.();
  const second = await secondPromise;

  expect(loadHistory).toHaveBeenCalledTimes(2);
  expect(second.agent.messages.map(({ id }) => id)).toEqual(["message_two"]);
  await (
    second as typeof second & { release?: () => void | Promise<void> }
  ).release?.();
});
