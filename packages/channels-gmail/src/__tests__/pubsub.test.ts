import { describe, expect, it } from "vitest";
import {
  GoogleKeys,
  PushAuthError,
  parsePushBody,
  verifyOidcToken,
  verifySharedToken,
} from "../pubsub.js";
import { FakeGmail } from "./fake-gmail.js";
import { signer } from "./oidc-signer.js";

const now = 1_700_000_000_000;
const claims = (over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: "https://bot.test/gmail",
  email: "push@proj.iam.gserviceaccount.com",
  email_verified: true,
  iat: now / 1000 - 10,
  exp: now / 1000 + 3600,
  sub: "123",
  ...over,
});

function keys(): { keys: GoogleKeys; gmail: FakeGmail } {
  const gmail = new FakeGmail();
  gmail.jwks = signer.jwks;
  return { keys: new GoogleKeys(gmail.fetch, () => now), gmail };
}

const opts = {
  audience: "https://bot.test/gmail",
  serviceAccountEmail: "push@proj.iam.gserviceaccount.com",
};

describe("verifyOidcToken", () => {
  it("accepts a token Google signed for this audience and account", async () => {
    const { keys: k } = keys();
    await expect(
      verifyOidcToken(`Bearer ${signer.token(claims())}`, opts, k, () => now),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["no header", null],
    ["not a bearer token", "Basic abc"],
    [
      "wrong audience",
      `Bearer ${signer.token(claims({ aud: "https://other" }))}`,
    ],
    ["wrong issuer", `Bearer ${signer.token(claims({ iss: "https://evil" }))}`],
    ["expired", `Bearer ${signer.token(claims({ exp: now / 1000 - 600 }))}`],
    [
      "wrong account",
      `Bearer ${signer.token(claims({ email: "x@y.iam.gserviceaccount.com" }))}`,
    ],
    [
      "unverified email",
      `Bearer ${signer.token(claims({ email_verified: false }))}`,
    ],
    ["unknown key", `Bearer ${signer.token(claims(), "other")}`],
  ])("rejects %s", async (_name, header) => {
    const { keys: k } = keys();
    await expect(
      verifyOidcToken(header, opts, k, () => now),
    ).rejects.toBeInstanceOf(PushAuthError);
  });

  it("rejects a tampered token", async () => {
    const { keys: k } = keys();
    const [head, , sig] = signer.token(claims()).split(".");
    const forged = Buffer.from(
      JSON.stringify(
        claims({ aud: "https://bot.test/gmail", sub: "attacker" }),
      ),
    ).toString("base64url");
    await expect(
      verifyOidcToken(`Bearer ${head}.${forged}.${sig}`, opts, k, () => now),
    ).rejects.toThrow(/bad signature/);
  });

  it("does not check the account when none is configured", async () => {
    const { keys: k } = keys();
    await expect(
      verifyOidcToken(
        `Bearer ${signer.token(claims({ email: "any@x.iam.gserviceaccount.com" }))}`,
        { audience: opts.audience },
        k,
        () => now,
      ),
    ).resolves.toBeUndefined();
  });

  it("caches Google's keys", async () => {
    const { keys: k, gmail } = keys();
    const header = `Bearer ${signer.token(claims())}`;
    await verifyOidcToken(header, opts, k, () => now);
    await verifyOidcToken(header, opts, k, () => now);
    expect(gmail.calls.filter((c) => c.includes("certs"))).toHaveLength(1);
  });
});

describe("verifySharedToken", () => {
  it("accepts the matching token and rejects others", () => {
    expect(() =>
      verifySharedToken(new URL("https://b.test/gmail?token=s3cret"), "s3cret"),
    ).not.toThrow();
    expect(() =>
      verifySharedToken(new URL("https://b.test/gmail?token=nope"), "s3cret"),
    ).toThrow(PushAuthError);
    expect(() =>
      verifySharedToken(new URL("https://b.test/gmail"), "s3cret"),
    ).toThrow(PushAuthError);
  });
});

describe("parsePushBody", () => {
  const push = (data: unknown) => ({
    message: {
      data: Buffer.from(JSON.stringify(data)).toString("base64"),
      messageId: "ps-1",
    },
    subscription: "projects/p/subscriptions/s",
  });

  it("reads the Gmail notification", () => {
    expect(
      parsePushBody(push({ emailAddress: "Bot@Example.com", historyId: 1234 })),
    ).toEqual({
      emailAddress: "bot@example.com",
      historyId: "1234",
      pubsubMessageId: "ps-1",
    });
  });

  it("rejects bodies that are not Gmail notifications", () => {
    expect(parsePushBody(undefined)).toBeUndefined();
    expect(parsePushBody({ message: {} })).toBeUndefined();
    expect(parsePushBody(push({ emailAddress: "a@b.c" }))).toBeUndefined();
    expect(
      parsePushBody(push({ emailAddress: "a@b.c", historyId: "12x" })),
    ).toBeUndefined();
    expect(parsePushBody({ message: { data: "!!!" } })).toBeUndefined();
  });
});
