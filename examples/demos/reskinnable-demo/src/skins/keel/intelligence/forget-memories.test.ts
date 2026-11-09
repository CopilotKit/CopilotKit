import { describe, it, expect, vi, afterEach } from "vitest";
import { forgetAllMemories } from "./forget-memories";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "keel-sam-okafor",
};

const listOf = (
  memories: Array<{ id: string; scope?: string }> | unknown,
  status = 200,
) => new Response(JSON.stringify({ memories }), { status });

const noContent = () => new Response(null, { status: 204 });

const deletedUrls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "DELETE")
    .map(([url]) => String(url));

/** A fetch that never answers, and only settles when its signal aborts. */
const hangUntilAborted = () => (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no signal wired => hangs forever, and the test fails
    signal.addEventListener("abort", () =>
      reject(signal.reason ?? new Error("aborted")),
    );
  });

describe("forgetAllMemories", () => {
  it("enumerates, dedups ids, deletes each once, and re-lists to PROVE the bucket is clear", async () => {
    const fetchMock = vi
      .fn()
      // include a duplicate id to prove dedup
      .mockResolvedValueOnce(
        listOf([{ id: "a" }, { id: "b" }, { id: "b" }, { id: "c" }]),
      )
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      // verification pass: nothing left
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 3,
      alreadyGone: 0,
      failed: [],
      passes: 2,
      complete: true,
    });
    expect(result.incompleteReason).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://x:7450/api/memories",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer k",
          "x-cpki-user-id": "keel-sam-okafor",
        }),
      }),
    );
    expect(deletedUrls(fetchMock)).toEqual([
      "http://x:7450/api/memories/a",
      "http://x:7450/api/memories/b",
      "http://x:7450/api/memories/c",
    ]);
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
    expect(deletedUrls(fetchMock)).toEqual(["http://x:7450/api/memories/a"]);
  });

  // ── DEFECT 1: a 404 must not abort the sweep ────────────────────────────────
  it("treats a 404 on delete as success and keeps sweeping the remaining rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }, { id: "c" }]))
      .mockResolvedValueOnce(new Response("gone", { status: 404 }))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 2,
      alreadyGone: 1,
      failed: [],
      complete: true,
    });
    // The rows AFTER the 404 were still attempted — the old code threw here.
    expect(deletedUrls(fetchMock)).toEqual([
      "http://x:7450/api/memories/a",
      "http://x:7450/api/memories/b",
      "http://x:7450/api/memories/c",
    ]);
  });

  it("reports a genuine delete failure instead of swallowing it or aborting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "a" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.forgot).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/failed to delete/);
    expect(result.failed).toEqual([
      { id: "a", reason: expect.stringMatching(/500[\s\S]*boom/) },
    ]);
    // b was still deleted despite a failing first.
    expect(deletedUrls(fetchMock)).toEqual([
      "http://x:7450/api/memories/a",
      "http://x:7450/api/memories/b",
    ]);
  });

  it("does not retry a row that already failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(listOf([{ id: "a" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.passes).toBe(2);
    expect(deletedUrls(fetchMock)).toEqual(["http://x:7450/api/memories/a"]);
    expect(result.complete).toBe(false);
  });

  // ── DEFECT 2: one bare list is NOT assumed exhaustive ───────────────────────
  it("keeps sweeping until a list comes back empty, so a truncated page leaves nothing behind", async () => {
    const fetchMock = vi
      .fn()
      // page 1 of a paginated backend
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent())
      // deleting page 1 revealed page 2
      .mockResolvedValueOnce(listOf([{ id: "c" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({ forgot: 3, passes: 3, complete: true });
    expect(deletedUrls(fetchMock)).toEqual([
      "http://x:7450/api/memories/a",
      "http://x:7450/api/memories/b",
      "http://x:7450/api/memories/c",
    ]);
  });

  it("reports partial rather than success when the pass budget runs out", async () => {
    let n = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return Promise.resolve(noContent());
      n += 1;
      // a bottomless backend: every list hands back one more unseen row
      return Promise.resolve(listOf([{ id: `row-${n}` }]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories({ ...API, maxPasses: 3 });

    expect(result.passes).toBe(3);
    expect(result.forgot).toBe(3);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/pass budget \(3\)/);
  });

  it("refuses to claim success when the backend re-lists rows it said it deleted", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "DELETE" ? noContent() : listOf([{ id: "zombie" }]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories({ ...API, maxPasses: 5 });

    // Counted ONCE, not once per pass, and not reported as clear.
    expect(result.forgot).toBe(1);
    expect(result.passes).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/already deleted/);
  });

  // ── DEFECT 3: the envelope is validated, and errors name THIS layer ─────────
  it("fails with a message naming this module when the list envelope changes shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [{ id: "a" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*unexpected GET \/api\/memories envelope/,
    );
    // and NOT the misleading downstream symptom
    await expect(forgetAllMemories(API)).rejects.not.toThrow(
      /reading 'filter'/,
    );
  });

  it("fails when a row is missing its id, naming the row index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(listOf([{ id: "a" }, { scope: "user" }])),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*row 1.*\{ id: string \}/,
    );
  });

  it("fails when a row's scope is not a string, rather than risking a project row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(listOf([{ id: "a", scope: 7 }])),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*scope must be a string/,
    );
  });

  it("fails when the list body is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>502</html>", { status: 200 })),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*not JSON/,
    );
  });

  it("throws when listing fails, since nothing can be enumerated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("nope", { status: 401 })),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*401/,
    );
  });

  // ── DEFECT 4: every request is bounded ──────────────────────────────────────
  it("passes an AbortSignal on every request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    await forgetAllMemories(API);

    expect(fetchMock.mock.calls).toHaveLength(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("aborts a hung LIST within the timeout instead of hanging the reset", async () => {
    vi.stubGlobal("fetch", vi.fn(hangUntilAborted()));

    const started = Date.now();
    await expect(forgetAllMemories({ ...API, timeoutMs: 30 })).rejects.toThrow(
      /\[keel\/forget-memories\][\s\S]*TimeoutError/,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("aborts a hung DELETE within the timeout and reports it as a failure", async () => {
    const hang = hangUntilAborted();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return hang(url, init);
      return Promise.resolve(listOf([{ id: "a" }]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = Date.now();
    const result = await forgetAllMemories({ ...API, timeoutMs: 30 });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.forgot).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.failed).toEqual([
      { id: "a", reason: expect.stringMatching(/30ms.*TimeoutError/) },
    ]);
  });

  it("counts project-scoped rows as a union across passes, not just the last page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        listOf([{ id: "a" }, { id: "p1", scope: "project" }]),
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

    expect(result.skippedProjectScoped).toBe(2);
    expect(result.complete).toBe(true);
  });

  it("never claims a clear it did not even attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories({ ...API, maxPasses: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/no list pass ran/);
  });

  it("strips a trailing slash from apiUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(listOf([]));
    vi.stubGlobal("fetch", fetchMock);
    await forgetAllMemories({ ...API, apiUrl: "http://x:7450/" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://x:7450/api/memories",
      expect.anything(),
    );
  });

  it("reports a clear, complete sweep when memory is already empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 0,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      failed: [],
      passes: 1,
      complete: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
