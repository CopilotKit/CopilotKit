// packages/channels-ui/src/emoji.test.ts
import { describe, it, expect } from "vitest";
import {
  emoji,
  toPlatformEmoji,
  toCanonicalEmoji,
  normalizeEmoji,
  EMOJI_TABLE,
} from "./emoji.js";

describe("emoji table", () => {
  it("exposes typed canonical names via the `emoji` map", () => {
    expect(emoji.thumbs_up).toBe("thumbs_up");
    expect(emoji.heart).toBe("heart");
  });

  it("round-trips every entry through each platform", () => {
    for (const e of EMOJI_TABLE) {
      // Slack egress uses the first shortcode; ingress normalizes any alias.
      expect(toPlatformEmoji(e.name, "slack")).toBe(e.slack[0]);
      for (const code of e.slack) {
        expect(normalizeEmoji(code, "slack")).toBe(e.name);
      }
      // Discord + Telegram use the Unicode token both ways.
      expect(toPlatformEmoji(e.name, "discord")).toBe(e.unicode);
      expect(toPlatformEmoji(e.name, "telegram")).toBe(e.unicode);
      expect(normalizeEmoji(e.unicode, "discord")).toBe(e.name);
      expect(normalizeEmoji(e.unicode, "telegram")).toBe(e.name);
    }
  });

  it("resolves cross-form egress inputs (unicode + slack alias)", () => {
    // Unicode token → Slack shortcode.
    expect(toPlatformEmoji("👍", "slack")).toBe("+1");
    // Slack alias → canonical Slack shortcode.
    expect(toPlatformEmoji("thumbsup", "slack")).toBe("+1");
    // Unicode token → Discord stays Unicode.
    expect(toPlatformEmoji("👍", "discord")).toBe("👍");
    // Canonical name still works.
    expect(toPlatformEmoji(emoji.thumbs_up, "slack")).toBe("+1");
    // Unknown / custom emoji still passes through as undefined.
    expect(toPlatformEmoji("party_parrot", "slack")).toBeUndefined();
  });

  it("tolerates a missing trailing variation selector (U+FE0F) on ingress", () => {
    // Discord/Telegram sometimes deliver/cache the bare codepoint without the
    // VS16 the table stores. Both the qualified and bare forms must normalize.
    expect(normalizeEmoji("❤️", "discord")).toBe("heart"); // qualified (U+2764 U+FE0F)
    expect(normalizeEmoji("❤", "discord")).toBe("heart"); // bare (U+2764)
    expect(normalizeEmoji("⚠️", "telegram")).toBe("warning"); // qualified (U+26A0 U+FE0F)
    expect(normalizeEmoji("⚠", "telegram")).toBe("warning"); // bare (U+26A0)
  });

  it("normalizes the bug emoji across platforms", () => {
    expect(normalizeEmoji("🐛", "discord")).toBe("bug");
    expect(normalizeEmoji("bug", "slack")).toBe("bug");
    expect(toPlatformEmoji("bug", "slack")).toBe("bug");
  });

  it("resolves any form to its canonical name (platform-agnostic)", () => {
    expect(toCanonicalEmoji("👍")).toBe("thumbs_up"); // unicode
    expect(toCanonicalEmoji("thumbsup")).toBe("thumbs_up"); // slack alias
    expect(toCanonicalEmoji("+1")).toBe("thumbs_up"); // canonical slack shortcode
    expect(toCanonicalEmoji("thumbs_up")).toBe("thumbs_up"); // already canonical
    expect(toCanonicalEmoji("❤")).toBe("heart"); // bare codepoint (no VS16)
    expect(toCanonicalEmoji("❤️")).toBe("heart"); // qualified (VS16)
    // Unknown / custom emoji passes through unchanged.
    expect(toCanonicalEmoji("party_parrot")).toBe("party_parrot");
  });

  it("returns undefined for unknown tokens (passthrough)", () => {
    expect(toPlatformEmoji("party_parrot", "slack")).toBeUndefined();
    expect(normalizeEmoji(":shrug:", "slack")).toBeUndefined();
    expect(normalizeEmoji("🦜", "discord")).toBeUndefined();
  });
});
