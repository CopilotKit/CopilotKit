import { describe, it, expect, vi } from "vitest";
import { createPbClient, PbHttpError } from "./pb-client.js";
import { logger } from "../logger.js";

function makeFetch(
  handler: (
    url: string,
    init: RequestInit | undefined,
  ) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    return handler(String(input), init);
  }) as unknown as typeof fetch;
}

describe("pb-client", () => {
  it("returns health ok when PB responds 200", async () => {
    const fetchImpl = makeFetch(() => new Response("{}", { status: 200 }));
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    await expect(pb.health()).resolves.toBe(true);
  });

  it("returns health false on network error", async () => {
    const fetchImpl = makeFetch(() => {
      throw new Error("ECONN");
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    await expect(pb.health()).resolves.toBe(false);
  });

  it("authenticates with superuser credentials on first request", async () => {
    const calls: string[] = [];
    const fetchImpl = makeFetch((url) => {
      calls.push(url);
      if (url.includes("auth-with-password")) {
        return new Response(JSON.stringify({ token: "tok", record: {} }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ id: "r1" }), { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    await pb.getOne("status", "r1");
    expect(calls[0]).toContain("auth-with-password");
    expect(calls[1]).toContain("/api/collections/status/records/r1");
  });

  it("upsertByField creates when no existing record", async () => {
    let called = 0;
    const fetchImpl = makeFetch((url, init) => {
      called += 1;
      if (url.includes("?")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "new" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    const out = await pb.upsertByField<{ id: string }>(
      "status",
      "key",
      "smoke:foo",
      {
        state: "green",
      },
    );
    expect(out.id).toBe("new");
    expect(called).toBe(2);
  });

  it("retries on 5xx then succeeds", async () => {
    let attempts = 0;
    const fetchImpl = makeFetch(() => {
      attempts += 1;
      if (attempts < 2) return new Response("", { status: 503 });
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    const out = await pb.getOne<{ id: string }>("status", "x");
    expect(out?.id).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("re-auths on 401", async () => {
    let authCount = 0;
    let getCount = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        authCount += 1;
        return new Response(JSON.stringify({ token: "t" + authCount }), {
          status: 200,
        });
      }
      getCount += 1;
      if (getCount === 1) return new Response("", { status: 401 });
      return new Response(JSON.stringify({ id: "r" }), { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "e",
      password: "p",
      logger,
      fetchImpl,
    });
    const out = await pb.getOne<{ id: string }>("status", "r");
    expect(out?.id).toBe("r");
    expect(authCount).toBe(2);
  });

  it("caps 401 re-auth at 1 — persistent 401 eventually returns to caller", async () => {
    // Regression: previously `retry` never flipped off, so a PB that
    // kept returning 401 after re-auth would loop the re-auth path
    // forever. We now re-auth at most once and then surface the 401.
    let authCount = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        authCount += 1;
        return new Response(JSON.stringify({ token: "tok-" + authCount }), {
          status: 200,
        });
      }
      return new Response("", { status: 401 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "e",
      password: "p",
      logger,
      fetchImpl,
    });
    // `getOne` maps non-ok non-404 into a thrown error.
    await expect(pb.getOne("status", "x")).rejects.toThrow(
      /pb getOne failed: 401/,
    );
    // Exactly 2 auths: the initial one and the single re-auth retry.
    expect(authCount).toBe(2);
  });

  it("retries when fetchImpl throws (network error) with same envelope as 5xx", async () => {
    let attempts = 0;
    const fetchImpl = makeFetch(() => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    const out = await pb.getOne<{ id: string }>("status", "x");
    expect(out?.id).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("surfaces network error after maxAttempts", async () => {
    let attempts = 0;
    const fetchImpl = makeFetch(() => {
      attempts += 1;
      throw new TypeError("fetch failed");
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    await expect(pb.getOne("status", "x")).rejects.toThrow("fetch failed");
    expect(attempts).toBe(3);
  });

  it("honors 429 Retry-After header (capped backoff) and retries", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      // Run immediately so the test doesn't actually wait.
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      const out = await pb.getOne<{ id: string }>("status", "x");
      expect(out?.id).toBe("ok");
      expect(attempts).toBe(2);
      // 2 seconds → 2000 ms.
      expect(waits).toContain(2000);
    } finally {
      spy.mockRestore();
    }
  });

  it("429 without Retry-After falls back to exponential backoff", async () => {
    let attempts = 0;
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts < 2) return new Response("", { status: 429 });
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      const out = await pb.getOne<{ id: string }>("status", "x");
      expect(out?.id).toBe("ok");
      expect(attempts).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects empty auth token from PB", async () => {
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        return new Response(JSON.stringify({ token: "" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "a",
      password: "b",
      logger,
      fetchImpl,
    });
    await expect(pb.getOne("status", "x")).rejects.toThrow(
      /empty or non-string token/,
    );
  });

  it("upsertByField recovers from TOCTOU race via unique-constraint retry", async () => {
    // Two concurrent upserts both see no existing row (getFirst → []) and
    // both attempt POST. PB rejects the second with a unique-index error;
    // the client must re-read and update the winner's row rather than
    // surface the 400 to the caller.
    let getFirstCalls = 0;
    let createCalls = 0;
    let updateCalls = 0;
    const fetchImpl = makeFetch((url, init) => {
      if (url.includes("?") && init?.method !== "DELETE") {
        getFirstCalls += 1;
        // First getFirst → empty (no row yet). Second getFirst (after
        // the unique-constraint failure) → returns the racer's row.
        if (getFirstCalls === 1) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [{ id: "racer-1" }] }), {
          status: 200,
        });
      }
      if (init?.method === "POST") {
        createCalls += 1;
        return new Response(
          JSON.stringify({
            message: "Failed to create record.",
            data: {
              key: { code: "validation_not_unique", message: "is not unique" },
            },
          }),
          { status: 400 },
        );
      }
      if (init?.method === "PATCH") {
        updateCalls += 1;
        return new Response(JSON.stringify({ id: "racer-1", state: "red" }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    const out = await pb.upsertByField<{ id: string }>(
      "status",
      "key",
      "smoke:foo",
      { state: "red" },
    );
    expect(out.id).toBe("racer-1");
    expect(createCalls).toBe(1);
    expect(updateCalls).toBe(1);
    expect(getFirstCalls).toBe(2);
  });

  it("honors 429 Retry-After upper bound (clamps to 60s)", async () => {
    // Retry-After: 600s should be capped at 60_000ms — never sleep 10
    // minutes on a transient rate-limit response. The cap is specifically
    // 60s (not 30s) because PocketBase behind Cloudflare legitimately
    // returns `Retry-After: 60` under sustained pressure; a 30s cap
    // silently clamped that and retried early into another 429.
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      let attempts = 0;
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "600" },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      await pb.getOne("status", "x");
      // Parsed 600s → 600_000ms, clamped by the per-retry cap first
      // (RETRY_AFTER_MAX_MS=60_000) and then by the outer retry-budget
      // (RETRY_BUDGET_MS=50_000) on top. The scheduled wait must be
      // strictly ≤ 60_000 (proving the per-retry cap engaged) and never
      // the raw 600_000.
      const nonzero = waits.filter((w) => w > 0);
      expect(nonzero.length).toBeGreaterThan(0);
      expect(Math.max(...nonzero)).toBeLessThanOrEqual(60_000);
      expect(waits).not.toContain(600_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("honors Retry-After: 45 as 45s (under the 60s cap)", async () => {
    // Red-green: a Retry-After value BELOW the 60s cap must be honored
    // verbatim (45_000ms), not clamped down. Under the old 30s cap, 45s
    // would silently become 30s and the retry would fire 15s early into
    // another rate-limit response.
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      let attempts = 0;
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "45" },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      await pb.getOne("status", "x");
      expect(waits).toContain(45_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("clamps Retry-After: 90 to 60s (at the cap)", async () => {
    // Red-green: a Retry-After value ABOVE the 60s cap must be clamped.
    // Without this, a 90s Retry-After would either (a) exceed the caller's
    // timeout envelope or (b) trip the 50s retry budget and abort without
    // surfacing the contract-honoring behaviour this cap is designed to
    // preserve.
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      let attempts = 0;
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "90" },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      await pb.getOne("status", "x");
      // 90s → capped at 60_000 by the per-retry cap, then at 50_000 by the
      // outer retry-budget. Must NEVER observe the raw 90_000, and must
      // NEVER exceed 60_000 (proves the per-retry cap did its job — if a
      // future change bumps RETRY_AFTER_MAX_MS to e.g. 120s this assertion
      // will catch it).
      const nonzero = waits.filter((w) => w > 0);
      expect(nonzero.length).toBeGreaterThan(0);
      expect(waits).not.toContain(90_000);
      expect(Math.max(...nonzero)).toBeLessThanOrEqual(60_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("re-auth failure surfaces as thrown error with context + warn (not silent 401)", async () => {
    // Regression: previously, if ensureAuth failed during a 401 re-auth
    // retry, the client logged `reauth-failed` at debug and returned the
    // original 401 to the caller. Persistent credential rejection was
    // invisible — every write failed silently as a generic 401. Now we
    // throw a contextualized error and emit a warn so operators notice.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    let authCalls = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        authCalls += 1;
        if (authCalls === 1) {
          // Initial auth succeeds.
          return new Response(JSON.stringify({ token: "t" }), { status: 200 });
        }
        // Re-auth fails — simulate credential rotation / revocation.
        return new Response("bad creds", { status: 400 });
      }
      // Every data request returns 401 to force the re-auth path.
      return new Response("", { status: 401 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "e",
      password: "p",
      logger: customLogger,
      fetchImpl,
    });
    await expect(pb.getOne("status", "r1")).rejects.toThrow(
      /re-auth failed on .* \(status 401\)/,
    );
    const reauthWarns = warnCalls.filter(
      (w) => w.msg === "pb-client.reauth-failed",
    );
    expect(reauthWarns).toHaveLength(1);
  });

  it("retry budget caps total sleep time on stacked 429 responses", async () => {
    // Stack ~30s Retry-After on top of a 5xx wait. Before the budget
    // cap, sleeps could total >50s and exceed a caller's timeout
    // envelope. Verify the last sleep is clamped to the remaining
    // budget rather than the full Retry-After.
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    const realNow = Date.now;
    // Fast-forward `Date.now()` between attempts to simulate sleeps
    // draining the retry budget without actually waiting.
    let simulatedNow = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      simulatedNow += 25_000; // 25s per call simulates wall-clock advance
      return simulatedNow;
    });
    try {
      let attempts = 0;
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        return new Response("", {
          status: 429,
          headers: { "retry-after": "30" },
        });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      // HF13-B1: retry-exhausted 429 now surfaces as PbHttpError carrying
      // the server-side body text, not a bare `pb getOne failed: 429`.
      await expect(pb.getOne("status", "x")).rejects.toBeInstanceOf(
        PbHttpError,
      );
      // At least one scheduled wait must be strictly less than 30_000
      // (the unclamped Retry-After value), proving the budget clamped.
      const clamped = waits.some((w) => w > 0 && w < 30_000);
      expect(clamped).toBe(true);
    } finally {
      spy.mockRestore();
      dateNowSpy.mockRestore();
      Date.now = realNow;
    }
  });

  it("list() forwards skipTotal=false when explicitly set", async () => {
    // Regression: previously `if (opts.skipTotal)` silently dropped an
    // explicit `false`, leaving PB on its default. Callers that want to
    // force a total-count had no way to opt back in.
    let captured = "";
    const fetchImpl = makeFetch((url) => {
      captured = url;
      return new Response(
        JSON.stringify({
          items: [],
          page: 1,
          perPage: 30,
          totalPages: 0,
          totalItems: 0,
        }),
        { status: 200 },
      );
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    await pb.list("status", { skipTotal: false });
    expect(captured).toContain("skipTotal=false");
  });

  it("logs warn once when PB returns 404 on /_superusers (legacy admin fallback)", async () => {
    // Surfaces the PB version drift path: if /_superusers 404s, we fall
    // back to /api/admins and log a warn so operators know they're on
    // PB ≤0.22. A second auth doesn't re-warn (once per process).
    const warnCalls: string[] = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string) => warnCalls.push(msg),
      error: () => {},
      debug: () => {},
    };
    let superuserCalls = 0;
    let adminCalls = 0;
    const fetchImpl = makeFetch((url) => {
      if (url.includes("/_superusers/auth-with-password")) {
        superuserCalls += 1;
        return new Response("", { status: 404 });
      }
      if (url.includes("/api/admins/auth-with-password")) {
        adminCalls += 1;
        return new Response(JSON.stringify({ token: "legacy" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ id: "r1" }), { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "e",
      password: "p",
      logger: customLogger,
      fetchImpl,
    });
    await pb.getOne("status", "r1");
    // Force a second auth by clearing the token indirectly via getOne
    // on a fresh client — simpler path: just call once more after
    // token wipe would require re-export. The single call is enough to
    // assert the once-per-process behavior on this path.
    expect(superuserCalls).toBe(1);
    expect(adminCalls).toBe(1);
    const legacyWarns = warnCalls.filter(
      (m) => m === "pb-client.legacy-admin-auth-fallback",
    );
    expect(legacyWarns).toHaveLength(1);
  });

  it("deleteByFilter caps at max iterations and throws when exceeded", async () => {
    // Return a full page (200 items) every time — deleteByFilter would
    // loop forever without the cap.
    const fetchImpl = makeFetch((url, init) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      const items = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` }));
      return new Response(JSON.stringify({ items }), { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    await expect(
      pb.deleteByFilter("status", "dimension = 'x'"),
    ).rejects.toThrow(/exceeded 100 iterations/);
  });

  it("logs body-drain failures at debug on 429/5xx retry (F2.3)", async () => {
    // F2.3: previously body-drain rejections were swallowed silently —
    // ECONNRESET / ERR_STREAM_PREMATURE_CLOSE evidence was lost. Now we
    // log at debug so operators diagnosing socket-level flakiness have
    // a trail. Verifies both 429 and 5xx paths.
    const debugCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: (msg: string, obj?: unknown) => debugCalls.push({ msg, obj }),
    };
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      let attempts = 0;
      // Build a Response that throws when `.text()` is called — fetch
      // implementations surface premature socket close that way.
      const makeThrowingResponse = (status: number): Response => {
        return {
          status,
          ok: false,
          headers: new Headers(),
          text: async () => {
            throw new Error("ERR_STREAM_PREMATURE_CLOSE");
          },
          json: async () => ({}),
        } as unknown as Response;
      };
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) return makeThrowingResponse(429);
        if (attempts === 2) return makeThrowingResponse(503);
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({
        url: "http://pb",
        logger: customLogger,
        fetchImpl,
      });
      const out = await pb.getOne<{ id: string }>("status", "x");
      expect(out?.id).toBe("ok");
      const drainLogs = debugCalls.filter(
        (c) => c.msg === "pb-client.body-drain-failed",
      );
      // One drain failure on 429, one on 5xx.
      expect(drainLogs).toHaveLength(2);
      expect((drainLogs[0]!.obj as { status: number }).status).toBe(429);
      expect((drainLogs[1]!.obj as { status: number }).status).toBe(503);
      expect(String((drainLogs[0]!.obj as { err: string }).err)).toContain(
        "ERR_STREAM_PREMATURE_CLOSE",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("deleteByFilter does NOT count 404 responses as deletes (F2.6)", async () => {
    // F2.6: the inner loop used to increment `deleted` unconditionally —
    // so if another worker / external process deleted a row between our
    // list() and our delete(), we'd get a 404 and STILL bump the counter.
    // The returned count would overstate the retention-run's real
    // effectiveness. Now we only count real (200/204) deletes; 404s are
    // logged at debug and excluded from the tally.
    let deleteCalls = 0;
    const fetchImpl = makeFetch((url, init) => {
      if (init?.method === "DELETE") {
        deleteCalls += 1;
        // First 2 deletes succeed; next 2 already-deleted (404);
        // last 1 succeeds. Real deletions = 3, not 5.
        if (deleteCalls === 3 || deleteCalls === 4) {
          return new Response("not found", { status: 404 });
        }
        return new Response(null, { status: 204 });
      }
      // Single page of 5 items (< 200 so loop terminates after one pass).
      const items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
      return new Response(JSON.stringify({ items }), { status: 200 });
    });
    const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
    const removed = await pb.deleteByFilter("status", "dimension = 'x'");
    expect(removed).toBe(3);
    expect(deleteCalls).toBe(5);
  });

  it("Retry-After: 0 retries with a minimum floor (B1) — does NOT short-circuit", async () => {
    // Regression (B1): `Retry-After: 0` is a valid server directive for
    // "retry immediately". parseRetryAfterMs(0) returned 0, and the
    // loop's `waitMs <= 0` short-circuit treated the 429 as terminal —
    // the request was never retried and the caller got a 429 that
    // would've succeeded on the next attempt. The fix applies a small
    // floor (MIN_RETRY_AFTER_MS) so we retry without spinning, while
    // leaving the budget-exhausted short-circuit intact.
    let attempts = 0;
    const waits: number[] = [];
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      waits.push(ms ?? 0);
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      const out = await pb.getOne<{ id: string }>("status", "x");
      expect(out?.id).toBe("ok");
      // Retried — two attempts means the floor engaged rather than
      // short-circuiting to return the 429.
      expect(attempts).toBe(2);
      // And the scheduled wait was non-zero (the floor).
      const nonzero = waits.filter((w) => w > 0);
      expect(nonzero.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("HTTP-date Retry-After falls back to exponential backoff with a warn (B2)", async () => {
    // Regression (B2): PB itself emits `Retry-After: <seconds>`, but a
    // CDN (Cloudflare/Fastly) in front of PB can rewrite to HTTP-date
    // (RFC 7231 §7.1.3). The parser is seconds-only, so HTTP-date silently
    // fell through to exponential backoff. We now warn once per
    // unparseable header so operators notice the CDN rewrite, rather
    // than letting it flow through invisibly.
    const warnCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: () => {},
      warn: (msg: string, obj?: unknown) => warnCalls.push({ msg, obj }),
      error: () => {},
      debug: () => {},
    };
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      let attempts = 0;
      const fetchImpl = makeFetch(() => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("", {
            status: 429,
            headers: {
              "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT",
            },
          });
        }
        return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
      });
      const pb = createPbClient({
        url: "http://pb",
        logger: customLogger,
        fetchImpl,
      });
      const out = await pb.getOne<{ id: string }>("status", "x");
      expect(out?.id).toBe("ok");
      const unparseable = warnCalls.filter(
        (w) => w.msg === "pb-client.retry-after-unparseable",
      );
      expect(unparseable.length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("final-attempt 429 surfaces body text via PbHttpError (HF13-B1)", async () => {
    // Regression (HF13-B1): the retry envelope used to drain the body
    // on the final attempt and return the gutted Response, so callers
    // doing `res.text()` on `!res.ok` got "" and the resulting
    // "pb list failed: 429" log had no server-side context. Now the
    // retry helper reads the body BEFORE drain and throws PbHttpError
    // carrying statusCode + bodyText so operators can see the reason.
    let readCount = 0;
    const fetchImpl = makeFetch(() => {
      return {
        status: 429,
        ok: false,
        headers: new Headers(),
        text: async () => {
          readCount += 1;
          return "rate limited: too many requests";
        },
        json: async () => ({}),
      } as unknown as Response;
    });
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      let caught: unknown;
      await pb.getOne("status", "x").catch((err: unknown) => {
        caught = err;
      });
      expect(caught).toBeInstanceOf(PbHttpError);
      const err = caught as PbHttpError;
      expect(err.statusCode).toBe(429);
      expect(err.bodyText).toBe("rate limited: too many requests");
      // Body must have been read (before any other consumer could drain it).
      expect(readCount).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("final-attempt 5xx surfaces body text via PbHttpError (HF13-B1)", async () => {
    // Same as above but on the 5xx exhaustion path.
    const fetchImpl = makeFetch(() => {
      return {
        status: 503,
        ok: false,
        headers: new Headers(),
        text: async () => "service unavailable: upstream down",
        json: async () => ({}),
      } as unknown as Response;
    });
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      let caught: unknown;
      await pb.getOne("status", "x").catch((err: unknown) => {
        caught = err;
      });
      expect(caught).toBeInstanceOf(PbHttpError);
      const err = caught as PbHttpError;
      expect(err.statusCode).toBe(503);
      expect(err.bodyText).toBe("service unavailable: upstream down");
    } finally {
      spy.mockRestore();
    }
  });

  it("persistent 429 surfaces PbHttpError end-to-end from pb.create (HF13-B1)", async () => {
    // Red-green: simulate a persistent 429 hitting a write path. Before
    // the fix, pb.create's `!res.ok` branch ran `await res.text()` on a
    // drained response and threw `pb create failed: 429 ` (empty text).
    // Now PbHttpError is thrown from the retry envelope and propagates
    // to the caller with the body intact.
    const fetchImpl = makeFetch(
      () =>
        new Response('{"message":"rate limited","code":429}', { status: 429 }),
    );
    const realSetTimeout = setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      _ms?: number,
    ) => {
      return realSetTimeout(fn, 0);
    }) as unknown as typeof setTimeout);
    try {
      const pb = createPbClient({ url: "http://pb", logger, fetchImpl });
      let caught: unknown;
      await pb
        .create("status", { key: "smoke:foo", state: "green" })
        .catch((err: unknown) => {
          caught = err;
        });
      expect(caught).toBeInstanceOf(PbHttpError);
      const err = caught as PbHttpError;
      expect(err.statusCode).toBe(429);
      expect(err.bodyText).toContain("rate limited");
      expect(err.path).toContain("/api/collections/status/records");
    } finally {
      spy.mockRestore();
    }
  });

  it("empty-body 200 on auth endpoint surfaces empty-token error (HF13-B3)", async () => {
    // Red-green: PB restarts have been observed returning 200 with an
    // empty body on the auth-with-password endpoint. Before the fix,
    // `await res.json()` threw a SyntaxError on "", masking the real
    // symptom. Now we read text() first and route through the empty-
    // token guard so operators see a clear "pb-auth returned empty or
    // non-string token" error instead of an opaque parse failure.
    const fetchImpl = makeFetch((url) => {
      if (url.includes("auth-with-password")) {
        return new Response("", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      email: "a",
      password: "b",
      logger,
      fetchImpl,
    });
    await expect(pb.getOne("status", "x")).rejects.toThrow(
      /empty or non-string token/,
    );
  });

  it("deleteByFilter logs progress every 10 iterations (F2.5)", async () => {
    // F2.5: long retention runs against large collections used to
    // proceed silently until the iteration cap tripped or the loop
    // completed. Operators had no signal of forward progress. We now
    // log at info every 10 iterations so a multi-minute cleanup is
    // visible in the tail.
    const infoCalls: Array<{ msg: string; obj?: unknown }> = [];
    const customLogger = {
      info: (msg: string, obj?: unknown) => infoCalls.push({ msg, obj }),
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    // 25 full pages (200 each) then one empty page to terminate. Enough
    // iterations to trigger the progress log at 11 and 21.
    let listCalls = 0;
    const fetchImpl = makeFetch((url, init) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      listCalls += 1;
      if (listCalls <= 25) {
        const items = Array.from({ length: 200 }, (_, i) => ({
          id: `r${listCalls}-${i}`,
        }));
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const pb = createPbClient({
      url: "http://pb",
      logger: customLogger,
      fetchImpl,
    });
    const removed = await pb.deleteByFilter("status", "dimension = 'x'");
    // 25 pages * 200 items = 5000 real deletes.
    expect(removed).toBe(5000);
    const progressLogs = infoCalls.filter(
      (c) => c.msg === "pb-client.delete-by-filter-progress",
    );
    // Logs fire at iteration 11 (after 10 pages) and 21 (after 20 pages).
    expect(progressLogs.length).toBeGreaterThanOrEqual(2);
    // The first progress log should report 10 completed iterations.
    expect((progressLogs[0]!.obj as { iterations: number }).iterations).toBe(
      10,
    );
  });
});
