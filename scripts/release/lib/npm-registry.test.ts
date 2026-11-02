import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublishedVersions } from "./npm-registry.js";

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
      "https://registry.npmjs.org/@copilotkit%2freact-core",
      expect.anything(),
    );
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
