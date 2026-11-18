/**
 * The sweep's ONE job is to be able to PROVE a bucket is empty, so the cases
 * that matter most are the ones where it must refuse to claim it: a truncated
 * list, a row that would not delete, a backend that keeps re-listing rows it
 * said it deleted. Every one of those, reported as success, leaves beat 6
 * already taught — the demo still runs, and proves nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { forgetAllMemories } from "./forget-memories";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "meridian-demo-user",
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

describe("forgetAllMemories", () => {
  it("enumerates, dedups ids, deletes each once, and re-lists to PROVE the bucket is clear", async () => {
    const fetchMock = vi
      .fn()
      // a duplicate id, to prove dedup
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
          "x-cpki-user-id": "meridian-demo-user",
        }),
      }),
    );
    expect(deletedUrls(fetchMock)).toEqual([
      "http://x:7450/api/memories/a",
      "http://x:7450/api/memories/b",
      "http://x:7450/api/memories/c",
    ]);
  });

  it("keeps sweeping past a truncated page, because deleting reveals the next one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "b" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({ forgot: 2, passes: 3, complete: true });
  });

  it("leaves project-scoped rows alone and reports how many it saw", async () => {
    // A project row belongs to a sibling skin sharing this backend — deleting it
    // would silently destroy banking's seeded procedure on a Meridian reset.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        listOf([
          { id: "mine", scope: "user" },
          { id: "theirs", scope: "project" },
        ]),
      )
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "theirs", scope: "project" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 1,
      skippedProjectScoped: 1,
      complete: true,
    });
    expect(deletedUrls(fetchMock)).toEqual(["http://x:7450/api/memories/mine"]);
  });

  it("counts an already-absent row as gone without calling it forgotten", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(listOf([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toMatchObject({
      forgot: 1,
      alreadyGone: 1,
      complete: true,
    });
  });

  it("steps over a failed delete instead of abandoning the bucket, and refuses to call it complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "bad" }, { id: "good" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "bad" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.forgot).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ id: "bad" });
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/failed to delete/);
  });

  it("refuses to claim success when the backend re-lists rows it already deleted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "zombie" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(listOf([{ id: "zombie" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/still lists 1 row/);
  });

  it("stops at the pass budget rather than spinning, and says the rows are unverified", async () => {
    // A backend that hands back a fresh row forever. Without the bound this
    // never returns and the Reset button spins.
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE" ? noContent() : listOf([{ id: `r${n++}` }]),
      ),
    );

    const result = await forgetAllMemories({ ...API, maxPasses: 3 });

    expect(result.passes).toBe(3);
    expect(result.complete).toBe(false);
    expect(result.incompleteReason).toMatch(/pass budget \(3\)/);
  });

  it("throws a message naming THIS layer when a bucket cannot be enumerated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 })),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /\[logistics\/forget-memories\] list memories failed: 401/,
    );
  });

  it("rejects an unreadable list envelope instead of casting it", async () => {
    // The failure this prevents is "Cannot read properties of undefined
    // (reading 'filter')" thrown from the middle of a reset — a message naming
    // neither this module nor the backend.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(listOf(undefined)));
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /unexpected GET \/api\/memories envelope/,
    );
  });

  it("treats a non-string scope as an error, because the project skip is a comparison", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(listOf([{ id: "a", scope: 7 }])),
    );
    await expect(forgetAllMemories(API)).rejects.toThrow(
      /scope must be a string when present/,
    );
  });

  it("bounds every request so a wedged backend cannot hang the reset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            // No signal wired => this hangs forever and the test times out,
            // which is the failure being guarded against.
            signal?.addEventListener("abort", () =>
              reject(signal.reason ?? new Error("aborted")),
            );
          }),
      ),
    );

    const started = Date.now();
    await expect(forgetAllMemories({ ...API, timeoutMs: 30 })).rejects.toThrow(
      /list memories failed after 30ms/,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("cannot prove anything with no pass budget at all", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await forgetAllMemories({ ...API, maxPasses: 0 });
    expect(result).toMatchObject({ passes: 0, complete: false });
    expect(result.incompleteReason).toMatch(/no list pass ran/);
  });
});
