import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgetMemoriesError, forgetAllMemories } from "./forget-memories";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "vantage-demo-user",
};

const listOf = (memories: Array<{ id: string; scope?: string }>) =>
  new Response(JSON.stringify({ memories }), { status: 200 });

const noContent = () => new Response(null, { status: 204 });

describe("forgetAllMemories", () => {
  it("deletes every non-project row and reports how many", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(noContent());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toEqual({ forgot: 2, skippedProjectScoped: 0 });
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
      .mockResolvedValueOnce(noContent());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result).toEqual({ forgot: 1, skippedProjectScoped: 2 });
  });

  it("dedups a repeated id defensively", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "a" }]))
      .mockResolvedValueOnce(noContent());
    vi.stubGlobal("fetch", fetchMock);

    const result = await forgetAllMemories(API);

    expect(result.forgot).toBe(1);
    // one list call + exactly one DELETE, not two
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── the defect this cluster fixes ──────────────────────────────────────────
  it("carries the rows already deleted on a mid-bucket delete failure, instead of discarding that progress", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }, { id: "b" }, { id: "c" }]))
      .mockResolvedValueOnce(noContent()) // a: deleted
      .mockResolvedValueOnce(noContent()) // b: deleted
      .mockResolvedValueOnce(new Response("boom", { status: 500 })); // c: fails
    vi.stubGlobal("fetch", fetchMock);

    await expect(forgetAllMemories(API)).rejects.toMatchObject({
      forgot: 2,
    });
  });

  it("throws a ForgetMemoriesError instance, not a bare Error, on a delete failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listOf([{ id: "a" }]))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await forgetAllMemories(API);
    } catch (err) {
      caught = err;
    }
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

    let caught: unknown;
    try {
      await forgetAllMemories(API);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForgetMemoriesError);
    expect((caught as ForgetMemoriesError).forgot).toBe(0);
  });
});
