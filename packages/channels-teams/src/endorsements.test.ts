import { describe, it, expect, vi, afterEach } from "vitest";
import {
  BOT_FRAMEWORK_ISSUER,
  BOT_FRAMEWORK_KEYS_URL,
  createEndorsementCheck,
} from "./endorsements.js";

/** A bearer header whose (unverified here) JWT header names `kid`. */
function bearer(kid = "k1"): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString(
    "base64url",
  );
  return `Bearer ${header}.e30.sig`;
}

function keysResponse(keys: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ keys }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Replace global fetch for the key document only; nothing leaves the box. */
function stubFetch(impl: (init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url !== BOT_FRAMEWORK_KEYS_URL) {
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }
    return impl(init);
  });
}

describe("createEndorsementCheck", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares one key fetch between concurrent checks on a cold cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchSpy = stubFetch(async () => {
      await gate;
      return keysResponse([{ kid: "k1", endorsements: ["msteams"] }]);
    });
    const check = createEndorsementCheck();
    const results = Array.from({ length: 50 }, () =>
      check(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
    );
    release();
    const settled = await Promise.all(results);
    expect(settled.every((r) => r.ok)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails (rejects) instead of hanging when the key fetch does not answer", async () => {
    stubFetch(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const check = createEndorsementCheck({ fetchTimeoutMs: 50 });
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
    ).rejects.toThrow();
  }, 2000);

  it("passes a timeout signal to the key fetch by default", async () => {
    let signal: AbortSignal | null | undefined;
    stubFetch(async (init) => {
      signal = init?.signal;
      return keysResponse([{ kid: "k1" }]);
    });
    await createEndorsementCheck()(BOT_FRAMEWORK_ISSUER, bearer(), "msteams");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a key whose endorsements list is empty", async () => {
    stubFetch(async () => keysResponse([{ kid: "k1", endorsements: [] }]));
    const result = await createEndorsementCheck()(
      BOT_FRAMEWORK_ISSUER,
      bearer(),
      "msteams",
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: "signing key is not endorsed for this channel",
    });
  });

  it("accepts a key without an endorsements field", async () => {
    stubFetch(async () => keysResponse([{ kid: "k1" }]));
    const result = await createEndorsementCheck()(
      BOT_FRAMEWORK_ISSUER,
      bearer(),
      "msteams",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the key fetch throws or answers with an error", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    await expect(
      createEndorsementCheck()(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
    ).rejects.toThrow("network down");
    vi.restoreAllMocks();
    stubFetch(async () => keysResponse([], 500));
    await expect(
      createEndorsementCheck()(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
    ).rejects.toThrow("HTTP 500");
  });

  it("answers 401 when the key document has no matching key", async () => {
    stubFetch(async () => keysResponse([]));
    const result = await createEndorsementCheck()(
      BOT_FRAMEWORK_ISSUER,
      bearer(),
      "msteams",
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: "signing key not found",
    });
  });

  it("does not fetch keys for tokens from other issuers", async () => {
    const fetchSpy = stubFetch(async () => keysResponse([]));
    const result = await createEndorsementCheck()(
      "https://sts.windows.net/tenant-1/",
      bearer(),
      "msteams",
    );
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
