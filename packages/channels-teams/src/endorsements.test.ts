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

  it("suppresses sequential unknown-key refreshes after a warm-cache refresh fails", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchSpy = stubFetch(async () => keysResponse([], 503));
    fetchSpy.mockResolvedValueOnce(
      keysResponse([{ kid: "cached-key", endorsements: ["msteams"] }]),
    );
    const check = createEndorsementCheck();
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams"),
    ).resolves.toEqual({ ok: true });

    now += 30_001;
    const fetchCounts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await expect(
        check(BOT_FRAMEWORK_ISSUER, bearer("rotated-key"), "msteams"),
      ).rejects.toThrow("HTTP 503");
      fetchCounts.push(fetchSpy.mock.calls.length);
    }
    expect(fetchCounts).toEqual([2, 2, 2]);
  });

  it("keeps enforcing endorsements and the original cache TTL during failure cooldown", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchSpy = stubFetch(async () => keysResponse([], 503));
    fetchSpy.mockResolvedValueOnce(
      keysResponse([{ kid: "cached-key", endorsements: ["msteams"] }]),
    );
    const check = createEndorsementCheck();
    await check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams");

    now += 60 * 60 * 1000 - 1000;
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer("rotated-key"), "msteams"),
    ).rejects.toThrow("HTTP 503");
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams"),
    ).resolves.toEqual({ ok: true });
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "webchat"),
    ).resolves.toMatchObject({ ok: false, status: 403 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    now += 1001;
    await expect(
      check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams"),
    ).rejects.toThrow("HTTP 503");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each(["cold", "expired"])(
    "fails closed on a %s cache during cooldown, then shares one retry",
    async (cacheState) => {
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const fetchSpy = stubFetch(async () => keysResponse([], 503));
      const check = createEndorsementCheck();
      if (cacheState === "expired") {
        fetchSpy.mockResolvedValueOnce(
          keysResponse([{ kid: "cached-key", endorsements: ["msteams"] }]),
        );
        await check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams");
        now += 60 * 60 * 1000 + 1;
      }
      const expectedFetches = cacheState === "expired" ? 2 : 1;
      for (let i = 0; i < 3; i++) {
        await expect(
          check(BOT_FRAMEWORK_ISSUER, bearer("cached-key"), "msteams"),
        ).rejects.toThrow("HTTP 503");
        expect(fetchSpy).toHaveBeenCalledTimes(expectedFetches);
      }

      now += 29_999;
      await expect(
        check(BOT_FRAMEWORK_ISSUER, bearer("rotated-key"), "msteams"),
      ).rejects.toThrow("HTTP 503");
      expect(fetchSpy).toHaveBeenCalledTimes(expectedFetches);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      fetchSpy.mockImplementationOnce(async () => {
        await gate;
        return keysResponse([
          { kid: "rotated-key", endorsements: ["msteams"] },
        ]);
      });
      now += 1;
      const results = Array.from({ length: 10 }, () =>
        check(BOT_FRAMEWORK_ISSUER, bearer("rotated-key"), "msteams"),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(expectedFetches + 1);
      release();
      expect((await Promise.all(results)).every((result) => result.ok)).toBe(
        true,
      );

      now += 29_999;
      await expect(
        check(BOT_FRAMEWORK_ISSUER, bearer("missing-key"), "msteams"),
      ).resolves.toMatchObject({ ok: false, status: 401 });
      expect(fetchSpy).toHaveBeenCalledTimes(expectedFetches + 1);
    },
  );

  it.each(["network", "timeout", "JSON"])(
    "starts the cooldown when a %s failure completes",
    async (failure) => {
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const fetchSpy = stubFetch(async () => {
        now += 5000;
        if (failure === "JSON") return new Response("invalid JSON");
        throw new Error(failure);
      });
      const check = createEndorsementCheck();
      await expect(
        check(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
      ).rejects.toThrow();

      now += 29_999;
      await expect(
        check(BOT_FRAMEWORK_ISSUER, bearer(), "msteams"),
      ).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

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

  it("skips the check for a key whose endorsements list is empty, like the Bot Framework SDK", async () => {
    stubFetch(async () => keysResponse([{ kid: "k1", endorsements: [] }]));
    const result = await createEndorsementCheck()(
      BOT_FRAMEWORK_ISSUER,
      bearer(),
      "msteams",
    );
    expect(result).toEqual({ ok: true });
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
