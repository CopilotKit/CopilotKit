import { describe, expect, it, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type {
  RunAgentParameters,
  RunAgentResult,
  AgentSubscriber,
} from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type {
  ClaimedChannelDelivery,
  PreparedChannelDelivery,
} from "./delivery-transport.js";

class TestAgent extends AbstractAgent {
  run(_input: RunAgentInput): ReturnType<AbstractAgent["run"]> {
    throw new Error("unused");
  }
  override async runAgent(
    _parameters?: RunAgentParameters,
    _subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    return { result: undefined, newMessages: [] };
  }
  override clone(): TestAgent {
    const c = new TestAgent({ agentId: this.agentId });
    c.threadId = this.threadId;
    c.messages = structuredClone(this.messages);
    return c;
  }
}

function prepared(deliveryId: string): PreparedChannelDelivery {
  return {
    protocol: "channel_delivery_v1",
    deliveryId,
    deliveryExpiresAt: "2099-07-29T17:00:00.000Z",
    channelId: "channel_1",
    channelName: "support",
    canonicalThreadId: "thread_shared",
    appUserId: "slack:T1:U1",
    adapter: "slack",
    turn: {
      eventId: `evt_${deliveryId}`,
      receivedAt: "2026-07-29T17:00:00.000Z",
      input: {
        kind: "text",
        text: "hi",
        messageRef: { id: "pref_v1_message_concurrency_123" },
        operation: {
          kind: "created",
          logicalMessageId:
            "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
          revisionId: "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          mentioned: false,
        },
      },
      actor: { externalUserId: "U1", kind: "human" },
    },
  };
}

describe("DeliveryAdapter concurrent same-thread runs", () => {
  it("allows two concurrent getOrCreate calls for the same canonical thread", async () => {
    let release1!: () => void;
    const gate1 = new Promise<void>((r) => {
      release1 = r;
    });
    let loadCalls = 0;
    const gated = new DeliveryAdapter({
      channelName: "support",
      transport: {} as never,
      runCanonical: async () => ({ iterations: 0, interrupted: false }),
      loadHistory: async () => {
        loadCalls++;
        if (loadCalls === 1) await gate1;
        return [];
      },
    });

    const session = {} as ClaimedChannelDelivery;
    const d1 = {
      ...prepared("dlv_1"),
      turn: {
        ...prepared("dlv_1").turn,
        input: { kind: "welcome" as const },
      },
    };
    const d2 = {
      ...prepared("dlv_2"),
      turn: {
        ...prepared("dlv_2").turn,
        input: { kind: "welcome" as const },
      },
    };
    const makeAgent = (id: string) => {
      const a = new TestAgent({ agentId: "t" });
      a.threadId = id;
      return a;
    };

    const p1 = gated.conversationStore.getOrCreate(
      d1.canonicalThreadId,
      { claimedDelivery: session, delivery: d1 },
      makeAgent,
    );
    const p2 = gated.conversationStore.getOrCreate(
      d2.canonicalThreadId,
      { claimedDelivery: session, delivery: d2 },
      makeAgent,
    );

    // Both must be in flight — the second must not be rejected for overlapping.
    await vi.waitFor(() => expect(loadCalls).toBeGreaterThanOrEqual(1));
    release1();
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1.agent).not.toBe(s2.agent);
    s1.release?.();
    s2.release?.();
  });
});
