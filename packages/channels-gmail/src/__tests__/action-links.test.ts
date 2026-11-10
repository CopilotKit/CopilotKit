import { describe, expect, it } from "vitest";
import { actionUrl, signAction, verifyAction } from "../action-links.js";

const secret = "x".repeat(32);
const claims = {
  id: "ck:approve",
  value: { ok: true },
  conversationKey: "thread-1",
  recipient: "jane@example.org",
  label: "Approve",
};

describe("signed action links", () => {
  it("verifies a link it signed", () => {
    const token = signAction(secret, claims, { ttlMs: 60_000, now: 1000 });
    const result = verifyAction(secret, token, 2000);
    expect(result).toEqual({
      ok: true,
      claims: {
        ...claims,
        expiresAt: 61_000,
        nonce: expect.any(String),
      },
    });
  });

  it("gives every link its own nonce", () => {
    const a = verifyAction(secret, signAction(secret, claims, { ttlMs: 1000 }));
    const b = verifyAction(secret, signAction(secret, claims, { ttlMs: 1000 }));
    expect(a.ok && b.ok && a.claims.nonce !== b.claims.nonce).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = signAction(secret, claims, { ttlMs: 60_000 });
    const [payload, sig] = token.split(".") as [string, string];
    const wire = JSON.parse(Buffer.from(payload, "base64url").toString());
    wire.v = { ok: false };
    const forged = Buffer.from(JSON.stringify(wire)).toString("base64url");
    expect(verifyAction(secret, `${forged}.${sig}`)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a tampered signature, a different secret, and junk", () => {
    const token = signAction(secret, claims, { ttlMs: 60_000 });
    expect(verifyAction(secret, `${token.slice(0, -2)}AA`).ok).toBe(false);
    expect(verifyAction("y".repeat(32), token).ok).toBe(false);
    expect(verifyAction(secret, "junk").ok).toBe(false);
    expect(verifyAction(secret, "").ok).toBe(false);
  });

  it("rejects an expired link", () => {
    const token = signAction(secret, claims, { ttlMs: 1000, now: 0 });
    expect(verifyAction(secret, token, 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("puts the token in the `a` query parameter of the base URL", () => {
    expect(actionUrl("https://bot.test/gmail?x=1", "abc.def")).toBe(
      "https://bot.test/gmail?x=1&a=abc.def",
    );
  });
});
