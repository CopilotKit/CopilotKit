import { describe, it, expect, vi } from "vitest";
import { createPbClient } from "./pb-client.js";
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

  it("honors 429 Retry-After upper bound (clamps to 30s)", async () => {
    // Retry-After: 600s should be capped at 30_000ms — never sleep 10
    // minutes on a transient rate-limit response.
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
      // Parsed 600s → 600_000ms, clamped to 30_000.
      expect(waits).toContain(30_000);
      expect(waits).not.toContain(600_000);
    } finally {
      spy.mockRestore();
    }
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
});
