import { describe, expect, it } from "vitest";
import {
  ACTION_PARAM,
  actionLinkUrl,
  signActionLink,
  verifyActionLink,
} from "../action-links.js";

const SECRET = "test-link-secret-0123456789";
const NOW = 1_800_000_000_000;

function token(overrides: Partial<Parameters<typeof signActionLink>[1]> = {}) {
  return signActionLink(SECRET, {
    actionId: "ck:approve",
    value: { approved: true },
    conversationKey: "resend:root@x",
    recipient: "ann@example.com",
    expiresAt: NOW + 60_000,
    nonce: "nonce-1",
    label: "Approve",
    ...overrides,
  });
}

/** Rewrite one field of the signed payload, keeping the old signature. */
function tamper(t: string, change: (payload: Record<string, unknown>) => void) {
  const [payload, signature] = t.split(".");
  const data = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
  change(data);
  return `${Buffer.from(JSON.stringify(data)).toString("base64url")}.${signature}`;
}

describe("signed action links", () => {
  it("round-trips every claim", () => {
    expect(verifyActionLink(SECRET, token(), NOW)).toEqual({
      ok: true,
      claims: {
        actionId: "ck:approve",
        value: { approved: true },
        conversationKey: "resend:root@x",
        recipient: "ann@example.com",
        expiresAt: NOW + 60_000,
        nonce: "nonce-1",
        label: "Approve",
      },
    });
  });

  it("rejects a changed action id, value, conversation, or expiry", () => {
    const t = token();
    for (const change of [
      (p: Record<string, unknown>) => (p.a = "ck:delete-everything"),
      (p: Record<string, unknown>) => (p.v = { approved: false }),
      (p: Record<string, unknown>) => (p.k = "resend:other@x"),
      (p: Record<string, unknown>) => (p.e = NOW + 10 ** 12),
      (p: Record<string, unknown>) => (p.r = "mallory@example.com"),
    ]) {
      expect(verifyActionLink(SECRET, tamper(t, change), NOW)).toEqual({
        ok: false,
        reason: "bad-signature",
      });
    }
  });

  it("rejects a changed signature and a different secret", () => {
    const t = token();
    const flipped = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    expect(verifyActionLink(SECRET, flipped, NOW).ok).toBe(false);
    expect(verifyActionLink("another-secret", t, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects an expired link", () => {
    expect(
      verifyActionLink(SECRET, token({ expiresAt: NOW - 1 }), NOW),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", "a.b.c", ".sig"]) {
      expect(verifyActionLink(SECRET, bad, NOW)).toMatchObject({ ok: false });
    }
  });

  it("gives every link a fresh nonce by default", () => {
    const a = signActionLink(SECRET, {
      actionId: "ck:a",
      conversationKey: "k",
      recipient: "a@b.c",
      expiresAt: NOW + 1,
      label: "A",
    });
    const b = signActionLink(SECRET, {
      actionId: "ck:a",
      conversationKey: "k",
      recipient: "a@b.c",
      expiresAt: NOW + 1,
      label: "A",
    });
    expect(a).not.toBe(b);
  });

  it("adds the token to the base URL and keeps its query", () => {
    const url = new URL(
      actionLinkUrl("https://bot.example.com/hook?env=prod", "t.s"),
    );
    expect(url.searchParams.get("env")).toBe("prod");
    expect(url.searchParams.get(ACTION_PARAM)).toBe("t.s");
  });
});
