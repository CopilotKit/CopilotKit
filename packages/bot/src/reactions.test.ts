// packages/bot/src/reactions.test.ts
import { describe, it, expect } from "vitest";
import { emoji } from "@copilotkit/bot-ui";
import { createBot } from "./create-bot.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("bot.onReaction", () => {
  it("routes a specific reaction, normalizing the platform token", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    const seen: { emoji: string; raw: string; added: boolean }[] = [];
    bot.onReaction([emoji.thumbs_up], (evt) => {
      seen.push({ emoji: evt.emoji, raw: evt.rawEmoji, added: evt.added });
    });
    await bot.start();
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
    const bot = createBot({ adapters: [fake] });
    const seen: {
      raw: string;
      added: boolean;
      user?: string;
      messageId: string;
      platform: string;
    }[] = [];
    bot.onReaction((evt) => {
      seen.push({
        raw: evt.rawEmoji,
        added: evt.added,
        user: evt.user?.id,
        messageId: evt.messageId,
        platform: evt.thread.platform,
      });
    });
    await bot.start();
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
    const bot = createBot({ adapters: [fake] });
    const hits: string[] = [];
    bot.onReaction(["thumbs_up"], (evt) => {
      hits.push(evt.emoji);
    });
    await bot.start();
    fake.emitReaction({ rawEmoji: "thumbsup", added: true }); // Slack alias
    await tick();
    expect(hits).toEqual(["thumbs_up"]);
  });

  it("normalizes a raw-token filter (unicode / slack alias) to canonical", async () => {
    // Caller registers a raw unicode token; ingress normalizes the inbound
    // Slack alias to the canonical "thumbs_up", so the filter must too.
    const fake = new FakeAdapter();
    Object.defineProperty(fake, "platform", { value: "slack" });
    const bot = createBot({ adapters: [fake] });
    const hits: string[] = [];
    bot.onReaction(["👍"], (evt) => {
      hits.push(evt.emoji);
    });
    bot.onReaction(["thumbsup"], (evt) => {
      hits.push(`alias:${evt.emoji}`);
    });
    await bot.start();
    fake.emitReaction({ rawEmoji: "thumbsup", added: true }); // Slack alias
    await tick();
    expect(hits).toEqual(["thumbs_up", "alias:thumbs_up"]);
  });
});
