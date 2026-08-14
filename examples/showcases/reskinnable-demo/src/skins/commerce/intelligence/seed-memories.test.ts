import { describe, it, expect, vi, afterEach } from "vitest";
import { seedMemories, SEED_MEMORIES } from "./seed-memories";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "bellwether-nadia",
};

describe("seedMemories", () => {
  it("stores every seed memory and bounds each request with an AbortSignal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const stored = await seedMemories(API);

    expect(stored).toBe(SEED_MEMORIES.length);
    expect(fetchMock.mock.calls).toHaveLength(SEED_MEMORIES.length);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("http://x:7450/api/memories");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("aborts a hung POST within the timeout and counts it as not stored", async () => {
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    const started = Date.now();
    const stored = await seedMemories({ ...API, timeoutMs: 30 });

    expect(stored).toBe(0);
    // Bounded: without a signal this promise never settles and the reset spins.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(console.error).toHaveBeenCalled();
  });
});
