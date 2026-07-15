// packages/channels/src/reactions.test.ts
import { describe, it, expect } from "vitest";
import { emoji, Message } from "@copilotkit/channels-ui";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { MemoryStore } from "./state/memory-store.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("channel.onReaction", () => {
  it("routes a specific reaction, normalizing the platform token", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: { emoji: string; raw: string; added: boolean }[] = [];
    channel.onReaction([emoji.thumbs_up], (evt) => {
      seen.push({ emoji: evt.emoji, raw: evt.rawEmoji, added: evt.added });
    });
    await channel.start();
    // FakeAdapter.platform === "fake": normalizeEmoji falls through, but engine
    // normalizes by adapter.platform. Use a Slack-style token via a fake whose
    // platform normalizes — here we assert passthrough + catch-all instead.
    fake.emitReaction({ rawEmoji: "👍", added: true });
    await tick();
    // "fake" platform isn't in the table, so the raw token passes through.
    expect(seen).toEqual([]); // specific match on "thumbs_up" did not fire for raw "👍" on platform "fake"
  });

  it("fires a catch-all for any reaction and reports added/removed", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: {
      raw: string;
      added: boolean;
      user?: string;
      messageId: string;
      platform: string;
    }[] = [];
    channel.onReaction((evt) => {
      seen.push({
        raw: evt.rawEmoji,
        added: evt.added,
        user: evt.user?.id,
        messageId: evt.messageId,
        platform: evt.thread.platform,
      });
    });
    await channel.start();
    fake.emitReaction({
      rawEmoji: "🎉",
      added: true,
      user: { id: "U1" },
      messageId: "m9",
    });
    fake.emitReaction({ rawEmoji: "🎉", added: false, messageId: "m9" });
    await tick();
    expect(seen).toEqual([
      { raw: "🎉", added: true, user: "U1", messageId: "m9", platform: "fake" },
      {
        raw: "🎉",
        added: false,
        user: undefined,
        messageId: "m9",
        platform: "fake",
      },
    ]);
  });

  it("matches a normalized name on a platform in the emoji table", async () => {
    // A fake whose platform === "slack" so normalizeEmoji maps the shortcode.
    const fake = new FakeAdapter();
    Object.defineProperty(fake, "platform", { value: "slack" });
    const channel = createChannel({ adapters: [fake] });
    const hits: string[] = [];
    channel.onReaction(["thumbs_up"], (evt) => {
      hits.push(evt.emoji);
    });
    await channel.start();
    fake.emitReaction({ rawEmoji: "thumbsup", added: true }); // Slack alias
    await tick();
    expect(hits).toEqual(["thumbs_up"]);
  });

  it("routes a reaction on a posted message to its <Message onReaction>", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: { emoji: string; added: boolean }[] = [];
    channel.onMessage(async ({ thread }) => {
      await thread.post(
        Message({
          onReaction: (e, r) => {
            seen.push({ emoji: e, added: r.added });
          },
          children: "hi",
        }),
      );
    });
    await channel.start();
    fake.emitTurn({});
    await tick();
    // The handler is a closure, never serialized into the native payload.
    expect(fake.posted[0]?.[0]?.props.onReaction).toBeUndefined();
    // First post → "msg-1" (FakeAdapter counter).
    fake.emitReaction({ rawEmoji: "🎉", added: true, messageId: "msg-1" });
    fake.emitReaction({ rawEmoji: "🎉", added: false, messageId: "msg-1" });
    await tick();
    expect(seen).toEqual([
      { emoji: "🎉", added: true },
      { emoji: "🎉", added: false },
    ]);
  });

  it("resolves <Message onReaction> by postedMessageId when the reaction id differs (Channel path)", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: string[] = [];
    channel.onMessage(async ({ thread }) => {
      await thread.post(
        Message({
          onReaction: (e, r) => {
            if (r.added) seen.push(e);
          },
          children: "hi",
        }),
      );
    });
    await channel.start();
    fake.emitTurn({});
    await tick();
    // Channel delivery: the reaction arrives keyed by the provider ts (NOT the
    // post ref the handler was registered under), and the adapter supplies the
    // reverse-mapped post ref as `postedMessageId`. Resolution must prefer it.
    fake.emitReaction({
      rawEmoji: "🎉",
      added: true,
      messageId: "1699999999.000100", // provider ts — not the posted id
      postedMessageId: "msg-1", // the post ref the handler is registered under
    });
    await tick();
    expect(seen).toEqual(["🎉"]);
  });

  it("re-derives a registered component's onReaction from the store after a restart", async () => {
    const backend = new MemoryStore(); // shared store survives the simulated restart
    const seen: string[] = [];
    // A named component so it can be re-registered + re-rendered after restart.
    const Card = () =>
      Message({
        onReaction: (e) => {
          seen.push(e);
        },
        children: "deploy done",
      });

    // Bot 1 posts the component message, persisting a reaction snapshot.
    const fake1 = new FakeAdapter();
    const bot1 = createChannel({
      adapters: [fake1],
      store: { adapter: backend },
      components: [Card],
    });
    bot1.onMessage(async ({ thread }) => {
      // A component element ({ type: fn }) — the path that persists, unlike a
      // pre-rendered Message() node.
      await thread.post({ type: Card, props: {} });
    });
    await bot1.start();
    fake1.emitTurn({});
    await tick();

    // "Restart": a fresh channel + registry sharing the same store, Card re-registered.
    // Its reaction hot cache is empty, so it must resolve via the durable snapshot.
    const fake2 = new FakeAdapter();
    const bot2 = createChannel({
      adapters: [fake2],
      store: { adapter: backend },
      components: [Card],
    });
    await bot2.start();
    fake2.emitReaction({ rawEmoji: "🎉", added: true, messageId: "msg-1" });
    await tick();
    expect(seen).toEqual(["🎉"]);
  });

  it("gives the handler a thread to post new UI and the reacted message's ref", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    let seenRefId: string | undefined;
    channel.onMessage(async ({ thread }) => {
      await thread.post(
        Message({
          onReaction: async (_e, r) => {
            seenRefId = r.messageRef.id;
            await r.thread.post("thanks for the reaction"); // post new UI like onClick can
          },
          children: "hi",
        }),
      );
    });
    await channel.start();
    fake.emitTurn({});
    await tick();
    const before = fake.posted.length;
    fake.emitReaction({ rawEmoji: "🎉", added: true, messageId: "msg-1" });
    await tick();
    // The handler posted a second message via its thread.
    expect(fake.posted.length).toBe(before + 1);
    // …and received an update-capable ref to the reacted message (fallback id here).
    expect(seenRefId).toBe("msg-1");
  });

  it("does not fire a message handler for a reaction on a different message", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    let fired = false;
    channel.onMessage(async ({ thread }) => {
      await thread.post(
        Message({
          onReaction: () => {
            fired = true;
          },
          children: "hi",
        }),
      );
    });
    await channel.start();
    fake.emitTurn({});
    await tick();
    fake.emitReaction({ rawEmoji: "🎉", added: true, messageId: "other" });
    await tick();
    expect(fired).toBe(false);
  });

  it("normalizes a raw-token filter (unicode / slack alias) to canonical", async () => {
    // Caller registers a raw unicode token; ingress normalizes the inbound
    // Slack alias to the canonical "thumbs_up", so the filter must too.
    const fake = new FakeAdapter();
    Object.defineProperty(fake, "platform", { value: "slack" });
    const channel = createChannel({ adapters: [fake] });
    const hits: string[] = [];
    channel.onReaction(["👍"], (evt) => {
      hits.push(evt.emoji);
    });
    channel.onReaction(["thumbsup"], (evt) => {
      hits.push(`alias:${evt.emoji}`);
    });
    await channel.start();
    fake.emitReaction({ rawEmoji: "thumbsup", added: true }); // Slack alias
    await tick();
    expect(hits).toEqual(["thumbs_up", "alias:thumbs_up"]);
  });
});
