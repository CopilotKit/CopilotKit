import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "../svix.js";

// Test vector from Svix's manual-verification docs.
const SECRET = "whsec_plJ3nmyCDGBKInavdOK15jsl";
const BODY = '{"event_type":"ping","data":{"success":true}}';
const ID = "msg_loFOjxBNrRLzqYUf";
const TIMESTAMP = 1731705121;
const SIGNATURE = "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=";
const NOW = TIMESTAMP * 1000;

function headers(signature = SIGNATURE, timestamp = String(TIMESTAMP)) {
  return new Headers({
    "svix-id": ID,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  });
}

describe("verifyWebhook", () => {
  it("accepts Svix's published test vector", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headers(),
        body: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: true, id: ID, timestamp: TIMESTAMP });
  });

  it("signs the same way Svix does", () => {
    expect(`v1,${signWebhook(SECRET, ID, TIMESTAMP, BODY)}`).toBe(SIGNATURE);
  });

  it("rejects a tampered body", () => {
    const result = verifyWebhook({
      secret: SECRET,
      headers: headers(),
      body: BODY.replace("true", "false"),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "no matching signature" });
  });

  it("rejects a signature made with another secret", () => {
    const result = verifyWebhook({
      secret: "whsec_" + Buffer.from("another secret").toString("base64"),
      headers: headers(),
      body: BODY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stale timestamp, even with a valid signature", () => {
    const result = verifyWebhook({
      secret: SECRET,
      headers: headers(),
      body: BODY,
      now: NOW + 6 * 60 * 1000,
    });
    expect(result).toEqual({
      ok: false,
      reason: "timestamp outside tolerance",
    });
  });

  it("rejects a timestamp too far in the future", () => {
    const result = verifyWebhook({
      secret: SECRET,
      headers: headers(),
      body: BODY,
      now: NOW - 6 * 60 * 1000,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a timestamp inside the tolerance", () => {
    const result = verifyWebhook({
      secret: SECRET,
      headers: headers(),
      body: BODY,
      now: NOW + 4 * 60 * 1000,
    });
    expect(result.ok).toBe(true);
  });

  it("does not trust a re-signed timestamp: the timestamp is part of the signed content", () => {
    const later = TIMESTAMP + 60;
    const result = verifyWebhook({
      secret: SECRET,
      headers: headers(SIGNATURE, String(later)),
      body: BODY,
      now: later * 1000,
    });
    expect(result).toEqual({ ok: false, reason: "no matching signature" });
  });

  it("accepts any matching entry in a rotated, multi-signature header", () => {
    const rotated = `v1,${Buffer.from("old-secret-signature").toString("base64")} v2,ignored ${SIGNATURE}`;
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headers(rotated),
        body: BODY,
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("ignores non-v1 entries that carry the right bytes", () => {
    const wrongVersion = SIGNATURE.replace("v1,", "v2,");
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headers(wrongVersion),
        body: BODY,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  it("rejects requests without the signature headers", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: new Headers(),
        body: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "missing signature headers" });
  });

  it("accepts the webhook-* header names as well", () => {
    const h = new Headers({
      "webhook-id": ID,
      "webhook-timestamp": String(TIMESTAMP),
      "webhook-signature": SIGNATURE,
    });
    expect(
      verifyWebhook({ secret: SECRET, headers: h, body: BODY, now: NOW }).ok,
    ).toBe(true);
  });
});
