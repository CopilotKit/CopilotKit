/**
 * HERMETIC BY CONSTRUCTION: every case stubs `global.fetch` and the teardown
 * UN-stubs it (`vi.unstubAllGlobals`), so no case can leak a mock into the next
 * file or, worse, leave a real `fetch` in place for a case that forgot to stub.
 * `forgetAllMemories` takes its backend address as a parameter and reads no
 * `INTELLIGENCE_*` env var, so a developer with a real Intelligence stack
 * configured cannot make this suite DELETE anything in it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgetMemoriesError, forgetAllMemories } from "./forget-memories";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const API = {
  apiUrl: "http://intelligence.invalid:7450",
  apiKey: "cpk_test",
  userId: "vantage-demo-user",
};

const listOf = (memories: unknown) =>
  new Response(JSON.stringify({ memories }), { status: 200 });

/** An empty list — the pass that PROVES the bucket is clear. */
const emptyList = () => listOf([]);

const noContent = () => new Response(null, { status: 204 });

type Call = [url: string, init?: RequestInit];

const callsOf = (mock: ReturnType<typeof vi.fn>): Call[] =>
  mock.mock.calls as unknown as Call[];

describe("forgetAllMemories", () => {
  it("deletes every non-project row and reports how many", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(emptyList());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 2,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      complete: true,
    });
    expect(result.incompleteReason).toBeUndefined();
  });

  /**
   * THE REGRESSION THIS PINS: nothing used to assert the DELETE half's METHOD
   * or URL, so a sweep that silently issued GETs to `/api/memories/<id>` — or
   * dropped the auth/identity headers and got a 401 counted as a failure — kept
   * every assertion in this file green while clearing NOTHING. A reset that
   * deletes nothing and reports success is the exact failure mode that leaves
   * beat 6 already taught.
   */
  it("issues a DELETE per row, url-encoded, with the auth and identity headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "mem/one two" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(emptyList());
    vi.stubGlobal("fetch", fetchMock);

    await forgetAllMemories(API);

    const calls = callsOf(fetchMock);
    const [listUrl, listInit] = calls[0];
    expect(listUrl).toBe("http://intelligence.invalid:7450/api/memories");
    expect(listInit?.method ?? "GET").toBe("GET");

    const [delUrl, delInit] = calls[1];
    expect(delInit?.method).toBe("DELETE");
    // encodeURIComponent, not raw interpolation: a `/` in an id would
    // otherwise address a different path entirely.
    expect(delUrl).toBe(
      "http://intelligence.invalid:7450/api/memories/mem%2Fone%20two",
    );
    for (const [, init] of calls) {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer cpk_test",
        "x-cpki-user-id": "vantage-demo-user",
      });
    }
  });

  it("leaves project-scoped rows alone and reports the count", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        listOf([
          { id: "a", scope: "user" },
          { id: "p1", scope: "project" },
          { id: "p2", scope: "project" },
        ]),
      )
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(
        listOf([
          { id: "p1", scope: "project" },
          { id: "p2", scope: "project" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 1,
      skippedProjectScoped: 2,
      complete: true,
    });
    // Exactly one DELETE — never one aimed at a project-scoped id.
    const deletes = callsOf(fetchMock).filter(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toContain("/api/memories/a");
  });

  it("dedups a repeated id defensively", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "a" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(emptyList());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.forgot).toBe(1);
    expect(
      callsOf(fetchMock).filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  // ── already-gone rows ──────────────────────────────────────────────────────
  it.each([404, 410])(
    "counts a %s DELETE as already gone and keeps sweeping the bucket",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
        .mockResolvedValueOnce(new Response("gone", { status }))
        .mockResolvedValueOnce(noContent())
        .mockResolvedValueOnce(emptyList());
      vi.stubGlobal("fetch", fetchMock);

      // The defect: an already-deleted row (a concurrent reset, a backend TTL)
      // used to THROW and abandon every remaining row in the bucket — so one
      // harmless race left the rest of the bucket, where beat 6's teaching
      // actually lands, never even attempted.
      const result = await forgetAllMemories(API);

      expect(result).toMatchObject({
        forgot: 1,
        alreadyGone: 1,
        complete: true,
      });
    },
  );

  // ── hard failures still abort the bucket, carrying their progress ──────────
  it("carries the rows already deleted on a mid-bucket delete failure, instead of discarding that progress", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }, { id: "c" }]))
      .mockResolvedValueOnce(noContent()) // a: deleted
      .mockResolvedValueOnce(noContent()) // b: deleted
      .mockResolvedValueOnce(new Response("boom", { status: 500 })); // c: fails
    vi.stubGlobal("fetch", fetchMock);

    await expect(forgetAllMemories(API)).rejects.toMatchObject({ forgot: 2 });
  });

  it("throws a ForgetMemoriesError instance, not a bare Error, on a delete failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const caught = await forgetAllMemories(API).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect((caught as ForgetMemoriesError).forgot).toBe(0);
    expect((caught as ForgetMemoriesError).message).toMatch(
      /\[exec\/forget-memories\][\s\S]*delete memory a failed[\s\S]*500/,
    );
  });

  it("reports forgot: 0 on a list failure, since nothing was ever deletable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
    );

    const caught = await forgetAllMemories(API).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect((caught as ForgetMemoriesError).forgot).toBe(0);
  });

  // ── malformed 200s ─────────────────────────────────────────────────────────
  /**
   * THE DEFECT: the envelope was CAST (`as MemoriesListResponse`), so a
   * malformed 200 crashed as a bare `TypeError` ("Cannot read properties of
   * undefined (reading 'filter')") — which `dev/reset`'s
   * `err instanceof ForgetMemoriesError` check does not match, so the bucket's
   * partial `forgot` was discarded AND the error named neither this module nor
   * the backend, sending whoever was debugging to the wrong layer.
   */
  it.each([
    ["memories missing", {}],
    ["memories not an array", { memories: "all of them" }],
    ["envelope not an object", []],
    ["envelope null", null],
    ["row not an object", { memories: ["a"] }],
    ["row id missing", { memories: [{ scope: "user" }] }],
    ["row id empty", { memories: [{ id: "" }] }],
  ])(
    "wraps a malformed-200 list envelope (%s) in a ForgetMemoriesError",
    async (_label, payload) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(payload), { status: 200 }),
          ),
      );

      const caught = await forgetAllMemories(API).catch((err: unknown) => err);
      expect(caught).toBeInstanceOf(ForgetMemoriesError);
      expect((caught as ForgetMemoriesError).forgot).toBe(0);
      expect((caught as ForgetMemoriesError).message).toContain(
        "[exec/forget-memories]",
      );
    },
  );

  /**
   * A present-but-non-string `scope` is an ERROR rather than a shrug: the
   * project-scope skip is a `!== "project"` comparison, so an unreadable scope
   * would sail through it and get banking's seeded project rows deleted —
   * destroying a sibling demo's memory from Vantage's reset button.
   */
  it("refuses a row whose scope is not a string, rather than mis-targeting the delete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(listOf([{ id: "p1", scope: { kind: "project" } }]));
    vi.stubGlobal("fetch", fetchMock);

    const caught = await forgetAllMemories(API).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect((caught as ForgetMemoriesError).message).toMatch(/scope/i);
    // And it never issued the DELETE it could not justify.
    expect(
      callsOf(fetchMock).filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("wraps a 200 whose body is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>gateway</html>", {
          status: 200,
        }),
      ),
    );

    const caught = await forgetAllMemories(API).catch((err: unknown) => err);
    expect(caught).toBeInstanceOf(ForgetMemoriesError);
  });

  // ── bounded requests ───────────────────────────────────────────────────────
  it("bounds the list and every DELETE with an AbortSignal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(emptyList());
    vi.stubGlobal("fetch", fetchMock);

    await forgetAllMemories(API);

    for (const [, init] of callsOf(fetchMock)) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("aborts a hung list within the timeout instead of spinning the Reset button forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason ?? new Error("aborted")),
            );
          }),
      ),
    );

    const started = Date.now();
    const caught = await forgetAllMemories({ ...API, timeoutMs: 30 }).catch(
      (err: unknown) => err,
    );

    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("aborts a hung DELETE within the timeout, carrying the progress made", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) return Promise.resolve(listOf([{ id: "a" }]));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        });
      }),
    );

    const started = Date.now();
    const caught = await forgetAllMemories({ ...API, timeoutMs: 30 }).catch(
      (err: unknown) => err,
    );

    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect((caught as ForgetMemoriesError).forgot).toBe(0);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  // ── pagination completeness ────────────────────────────────────────────────
  /**
   * The list endpoint's pagination contract is UNKNOWN and cannot be probed
   * (the backend 400s on ANY query string), so "one list saw everything" is an
   * assumption this module is not entitled to make. It VERIFIES instead:
   * list → delete → list again, until a pass comes back with nothing pending.
   */
  it("keeps sweeping until a list pass proves the bucket is clear", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }])) // page 1
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "b" }])) // page 2, revealed
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(emptyList());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({ forgot: 2, passes: 3, complete: true });
  });

  it("reports an INCOMPLETE sweep rather than claiming success when the pass budget runs out", async () => {
    // A backend that always has one more row: the sweep must not pretend it
    // finished. `dev/reset` turns `complete: false` into a non-ok response.
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return Promise.resolve(noContent());
        n += 1;
        return Promise.resolve(listOf([{ id: `row-${n}` }]));
      }),
    );

    const result = await forgetAllMemories({ ...API, maxPasses: 3 });

    expect(result.complete).toBe(false);
    expect(result.passes).toBe(3);
    expect(result.forgot).toBe(3);
    expect(result.incompleteReason).toMatch(/pass budget/i);
  });

  it("reports an INCOMPLETE sweep when the backend keeps listing rows it said it deleted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "a" }])); // zombie
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/already deleted/i);
    // It must not re-delete and re-count the same id.
    expect(result.forgot).toBe(1);
  });
});
