import { describe, it, expect, vi, afterEach } from "vitest";
import { forgetAllMemories } from "./forget-memories";

afterEach(() => vi.restoreAllMocks());

// NOTE: this backend rejects any query string on /api/memories (HTTP 400,
// MEMORY_VALIDATION_ERROR), so there is no `?scope=` filtering. The bare
// `GET /api/memories` already enumerates EVERY scope in one response, which is
// exactly what a scope-complete clear needs — enumerate once, delete each id.
describe("forgetAllMemories", () => {
  it("enumerates all scopes via a single GET, dedups ids, deletes each once, returns the count", async () => {
    const fetchMock = vi
      .fn()
      // bare list returns every scope; include a duplicate id to prove dedup
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memories: [{ id: "a" }, { id: "b" }, { id: "b" }, { id: "c" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const forgot = await forgetAllMemories({
      apiUrl: "http://x:7050",
      apiKey: "k",
      userId: "jordan-beamson",
    });

    expect(forgot).toBe(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://x:7050/api/memories",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer k",
          "x-cpki-user-id": "jordan-beamson",
        }),
      }),
    );
    const deleted = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "DELETE")
      .map(([url]) => url);
    expect(deleted).toEqual([
      "http://x:7050/api/memories/a",
      "http://x:7050/api/memories/b",
      "http://x:7050/api/memories/c",
    ]);
  });

  it("throws when listing fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      forgetAllMemories({ apiUrl: "http://x:7050", apiKey: "k", userId: "u" }),
    ).rejects.toThrow(/401/);
  });

  it("throws when a delete fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ memories: [{ id: "a" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      forgetAllMemories({ apiUrl: "http://x:7050", apiKey: "k", userId: "u" }),
    ).rejects.toThrow(/500/);
  });

  it("strips a trailing slash from apiUrl", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ memories: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await forgetAllMemories({
      apiUrl: "http://x:7050/",
      apiKey: "k",
      userId: "u",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://x:7050/api/memories",
      expect.anything(),
    );
  });

  it("returns 0 and issues no deletes when memory is already empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ memories: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const forgot = await forgetAllMemories({
      apiUrl: "http://x:7050",
      apiKey: "k",
      userId: "u",
    });
    expect(forgot).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
