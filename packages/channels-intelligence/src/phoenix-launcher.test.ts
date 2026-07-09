import { describe, it, expect } from "vitest";
import { createBot, FakeAgent } from "@copilotkit/channels";
import { Section } from "@copilotkit/channels-ui";
import { startManagedBotsOnChannel } from "./phoenix-launcher.js";
import type { HostedBotChannel } from "./phoenix-transport.js";

const scope = {
  organizationId: "org_1",
  projectId: 7,
  botId: "bot_1",
  botName: "opentag",
};

/** Fake gateway channel: records pushes, replies `render_accepted`, and exposes
 * the server-push handlers so a test can simulate `delivery.available`. */
function makeFakeChannel() {
  const pushes: { event: string; payload: unknown }[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const channel: HostedBotChannel = {
    push: async (event, payload) => {
      pushes.push({ event, payload });
      if (event === "hosted_bot.render_event.v1") {
        const p = (payload as { payload: Record<string, unknown> }).payload;
        return {
          type: "hosted_bot.render_accepted.v1",
          occurredAt: "2026-07-09T00:00:00.000Z",
          payload: {
            idempotencyKey: p.idempotencyKey,
            acceptance: "accepted",
            ...(p.event && (p.event as { kind: string }).kind === "finalize"
              ? { egressOperationId: "eop_1" }
              : {}),
          },
        };
      }
      return { status: "ok" };
    },
    on: (event, handler) => {
      handlers.set(event, handler);
    },
  };
  return { channel, pushes, handlers };
}

/** Simulate one leased text-turn delivery arriving over the channel. */
function deliverText(handlers: Map<string, (p: unknown) => void>) {
  handlers.get("hosted_bot.delivery.available.v1")?.({
    payload: {
      delivery: {
        id: "dlv_1",
        leaseToken: "lease_1",
        adapter: "slack",
        bot: { id: "bot_1", name: "opentag" },
        turn: {
          id: "turn_1",
          eventId: "evt_1",
          replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
          input: { kind: "text", text: "hi" },
        },
      },
    },
  });
}

/** The channel `delivery.available` handler is fire-and-forget, so poll until
 * the async dispatch→render→ack chain has produced the terminal event. */
async function waitFor(pred: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitFor: condition not met within the poll window");
}

describe("startManagedBotsOnChannel — managed runtime over Phoenix (OSS-406)", () => {
  it("runs a delivered turn end-to-end: handler → render frame → completion intent, never self-ack", async () => {
    const fake = makeFakeChannel();
    let ran = false;
    const bot = createBot({ name: "opentag", agent: () => new FakeAgent() });
    bot.onMessage(async ({ thread }) => {
      ran = true;
      await thread.post(Section({ children: "reply" }));
    });

    const handle = await startManagedBotsOnChannel([bot], {
      channel: fake.channel,
      scope,
      runtimeInstanceId: "rti_1",
    });

    deliverText(fake.handlers);
    await waitFor(() =>
      fake.pushes.some(
        (p) => p.event === "hosted_bot.delivery.complete_requested.v1",
      ),
    );

    const events = fake.pushes.map((p) => p.event);
    expect(ran).toBe(true); // the bot's handler ran off a Phoenix-delivered turn
    expect(events).toContain("hosted_bot.render_event.v1"); // rendered over the channel
    expect(events).toContain("hosted_bot.delivery.complete_requested.v1"); // completion INTENT
    expect(events).not.toContain("hosted_bot.delivery.ack.v1"); // SDK never commits the ack

    await handle.stop();
  });

  it("nacks (fail intent) when the handler throws — no completion intent, no self-ack", async () => {
    const fake = makeFakeChannel();
    const bot = createBot({ name: "opentag", agent: () => new FakeAgent() });
    bot.onMessage(async () => {
      throw new Error("boom");
    });

    const handle = await startManagedBotsOnChannel([bot], {
      channel: fake.channel,
      scope,
      runtimeInstanceId: "rti_1",
    });

    deliverText(fake.handlers);
    await waitFor(() =>
      fake.pushes.some((p) => p.event === "hosted_bot.delivery.fail.v1"),
    );

    const events = fake.pushes.map((p) => p.event);
    expect(events).toContain("hosted_bot.delivery.fail.v1");
    expect(events).not.toContain("hosted_bot.delivery.complete_requested.v1");
    expect(events).not.toContain("hosted_bot.delivery.ack.v1");

    await handle.stop();
  });
});
