import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPublishedVersions,
  waitForPublishedVersions,
} from "./npm-registry.js";

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body ?? {}), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPublishedVersions", () => {
  it("lists every published version", async () => {
    const fetchMock = stubFetch(200, {
      versions: { "1.83.0": {}, "2.0.0-rc.0": {} },
    });
    await expect(
      fetchPublishedVersions("@copilotkit/react-core"),
    ).resolves.toEqual(["1.83.0", "2.0.0-rc.0"]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/registry\.npmjs\.org\/@copilotkit%2freact-core\?/,
      ),
      expect.anything(),
    );
  });

  // npm's CDN caches a version list for up to five minutes, so a cached copy
  // can miss a version that was published since.
  it("asks for a copy that is not in npm's CDN cache", async () => {
    const fetchMock = stubFetch(200, { versions: { "1.0.0": {} } });
    await fetchPublishedVersions("@copilotkit/core");
    await fetchPublishedVersions("@copilotkit/core");
    const [first, second] = fetchMock.mock.calls.map((call) => call[0]);
    expect(first).not.toBe(second);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("returns nothing for a package that was never published", async () => {
    stubFetch(404);
    await expect(fetchPublishedVersions("@copilotkit/new")).resolves.toEqual(
      [],
    );
  });

  it("throws on any other error status", async () => {
    stubFetch(503);
    await expect(
      fetchPublishedVersions("@copilotkit/react-core"),
    ).rejects.toThrow(/returned 503/);
  });

  it("throws when a successful response has no versions", async () => {
    stubFetch(200, { name: "@copilotkit/react-core" });
    await expect(
      fetchPublishedVersions("@copilotkit/react-core"),
    ).rejects.toThrow(/has no versions/);
  });
});

describe("waitForPublishedVersions", () => {
  function stubRegistry(listings: Record<string, string[][]>) {
    const calls: Record<string, number> = {};
    const fetchMock = vi.fn(async (url: string) => {
      const name = decodeURIComponent(new URL(url).pathname.slice(1));
      const index = calls[name] ?? 0;
      calls[name] = index + 1;
      const pages = listings[name];
      const versions = pages[Math.min(index, pages.length - 1)];
      return new Response(
        JSON.stringify({
          versions: Object.fromEntries(versions.map((v) => [v, {}])),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("waits until npm lists every published version", async () => {
    const calls = stubRegistry({
      "@copilotkit/channels": [
        ["0.13.0-rc.1"],
        ["0.13.0-rc.1"],
        ["0.13.0-rc.2"],
      ],
      "@copilotkit/core": [["2.0.0-rc.54"]],
    });
    await waitForPublishedVersions(
      [
        { name: "@copilotkit/channels", version: "0.13.0-rc.2" },
        { name: "@copilotkit/core", version: "2.0.0-rc.54" },
      ],
      { timeoutMs: 1_000, intervalMs: 1 },
    );
    expect(calls["@copilotkit/channels"]).toBe(3);
    expect(calls["@copilotkit/core"]).toBe(1);
  });

  it("reads again after a failed registry read", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("", { status: 503 });
        if (calls === 2) throw new TypeError("fetch failed");
        return new Response(
          JSON.stringify({ versions: { "2.0.0-rc.58": {} } }),
          { status: 200 },
        );
      }),
    );
    await waitForPublishedVersions(
      [{ name: "@copilotkit/core", version: "2.0.0-rc.58" }],
      { timeoutMs: 1_000, intervalMs: 1 },
    );
    expect(calls).toBe(3);
  });

  it("names the last registry error when time runs out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(
      waitForPublishedVersions(
        [{ name: "@copilotkit/core", version: "2.0.0-rc.58" }],
        { timeoutMs: 20, intervalMs: 1 },
      ),
    ).rejects.toThrow(/@copilotkit\/core@2\.0\.0-rc\.58.*returned 503/);
  });

  it("names the versions npm still does not list when time runs out", async () => {
    stubRegistry({ "@copilotkit/channels": [["0.13.0-rc.1"]] });
    await expect(
      waitForPublishedVersions(
        [{ name: "@copilotkit/channels", version: "0.13.0-rc.2" }],
        { timeoutMs: 20, intervalMs: 1 },
      ),
    ).rejects.toThrow(/@copilotkit\/channels@0\.13\.0-rc\.2/);
  });
});
