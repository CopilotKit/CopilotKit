// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { collectNuget } from "../../../scripts/compatibility-audit/registries/nuget";
import type { HttpClient } from "../../../scripts/compatibility-audit/types";

const service = "https://api.nuget.org/v3/index.json";
const base = "https://api.nuget.org/v3/registration-test-semver2/";
const name = "Microsoft.Agents.AI.Harness";
const index = `${base}${name.toLowerCase()}/index.json`;
const published = "2026-09-11T16:57:28.753+00:00";
const serviceDocument = {
  version: "3.0.0",
  resources: [
    {
      "@id": "https://api.nuget.org/v3/old-registration/",
      "@type": "RegistrationsBaseUrl/3.4.0",
    },
    { "@id": base, "@type": "RegistrationsBaseUrl/3.6.0" },
  ],
};

function leaf(version: string, changes: Record<string, unknown> = {}) {
  return {
    "@id": `${base}${name.toLowerCase()}/${version.toLowerCase()}.json`,
    catalogEntry: {
      "@id": `https://api.nuget.org/v3/catalog0/data/example/${version.toLowerCase()}.json`,
      id: name,
      version,
      published,
      ...changes,
    },
  };
}

function page(items: ReturnType<typeof leaf>[]) {
  const lower = items[0].catalogEntry.version;
  const upper = items[items.length - 1].catalogEntry.version;
  return {
    "@id": `${index}#page/${lower}/${upper}`,
    count: items.length,
    lower,
    upper,
    parent: index,
    items,
  };
}

function fixture(documents: Record<string, unknown>) {
  const get = vi.fn<HttpClient["get"]>().mockImplementation(async (url) => {
    if (!Object.prototype.hasOwnProperty.call(documents, url))
      throw new Error("Fixture response is absent");
    return {
      url,
      status: 200,
      observedAt: "2026-09-30T15:00:00Z",
      body: JSON.stringify(documents[url]),
    };
  });
  return { client: { get }, get };
}

function inline(items: ReturnType<typeof leaf>[]) {
  return fixture({
    [service]: serviceDocument,
    [index]: { count: 1, items: [page(items)] },
  });
}

describe("NuGet release inventories", () => {
  it("discovers SemVer2 metadata and consumes valid embedded fragment pages without fetching them", async () => {
    const { client, get } = inline([
      leaf("1.6.1-preview.260514.1"),
      leaf("1.21.0", { listed: true, deprecation: { reasons: ["Legacy"] } }),
    ]);
    const result = await collectNuget(name, client);

    expect(get.mock.calls.map(([url]) => url)).toEqual([service, index]);
    expect(result).toMatchObject({
      registry: "nuget",
      name,
      complete: true,
      sourceUrl: `https://www.nuget.org/packages/${name}`,
    });
    expect(result.releases).toEqual([
      {
        version: "1.6.1-preview.260514.1",
        timestamp: published,
        timestampKind: "published",
        eligible: true,
      },
      {
        version: "1.21.0",
        timestamp: published,
        timestampKind: "published",
        eligible: true,
      },
    ]);
  });

  it("fetches all external pages by their discovered URLs", async () => {
    const first = {
      ...page([leaf("1.0.0"), leaf("1.0.1")]),
      "@id": `${base}opaque/page-one.json`,
    };
    const second = {
      ...page([leaf("2.0.0.1")]),
      "@id": `${base}opaque/page-two.json`,
    };
    const { items: _firstItems, ...firstReference } = first;
    const { items: _secondItems, ...secondReference } = second;
    const { client, get } = fixture({
      [service]: serviceDocument,
      [index]: { count: 2, items: [firstReference, secondReference] },
      [first["@id"]]: first,
      [second["@id"]]: second,
    });

    const result = await collectNuget(name, client);
    expect(result.complete).toBe(true);
    expect(result.releases.map((release) => release.version)).toEqual([
      "1.0.0",
      "1.0.1",
      "2.0.0.1",
    ]);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      service,
      index,
      first["@id"],
      second["@id"],
    ]);
  });

  it("does not confuse an unlisted sentinel with a publication date", async () => {
    const { client } = inline([
      leaf("1.0.0", { listed: false }),
      leaf("1.1.0", { published: "1900-01-01T00:00:00Z" }),
      leaf("1.2.0", { listed: false, published: undefined }),
      leaf("1.3.0"),
    ]);
    const result = await collectNuget(name, client);
    expect(result.complete).toBe(true);
    expect(result.releases).toEqual([
      {
        version: "1.0.0",
        timestamp: published,
        timestampKind: "published",
        eligible: false,
      },
      {
        version: "1.1.0",
        timestamp: null,
        timestampKind: "published",
        eligible: false,
      },
      {
        version: "1.2.0",
        timestamp: null,
        timestampKind: "published",
        eligible: false,
      },
      {
        version: "1.3.0",
        timestamp: published,
        timestampKind: "published",
        eligible: true,
      },
    ]);
  });

  it.each([undefined, null, "not-a-date", "2026-02-30T00:00:00Z"])(
    "preserves an unknown listed publication date and marks the inventory incomplete",
    async (value) => {
      const { client } = inline([leaf("1.0.0", { published: value })]);
      const result = await collectNuget(name, client);
      expect(result.complete).toBe(false);
      expect(result.releases[0]).toMatchObject({
        timestamp: null,
        eligible: true,
      });
      expect(result.diagnostics.join(" ")).toMatch(/publication date/);
    },
  );

  it("preserves valid preview, RC, build metadata, and four-part versions without scoring them", async () => {
    const { client } = inline([
      leaf("1.0.0-rc3"),
      leaf("1.0.0+metadata"),
      leaf("1.0.0.1"),
      leaf("1.6.1-preview.260514.12"),
    ]);
    const result = await collectNuget(name, client);
    expect(result.releases.map((release) => release.version)).toEqual([
      "1.0.0-rc3",
      "1.0.0+metadata",
      "1.0.0.1",
      "1.6.1-preview.260514.12",
    ]);
    expect(result.complete).toBe(true);
  });

  it.each([
    [leaf("1.0.0"), leaf("1.0.0")],
    [leaf("1.0.0"), leaf("1.0.0", { listed: false })],
    [leaf("1.0"), leaf("1.0.0+build")],
    [leaf("1.0.0-preview.260514.1"), leaf("1.0.0-PREVIEW.260514.1")],
  ])(
    "rejects duplicate or conflicting NuGet version identities",
    async (...items) => {
      const { client } = inline(items);
      await expect(collectNuget(name, client)).rejects.toThrow(
        /duplicate.*version/i,
      );
    },
  );

  it.each([
    { resources: [{ "@id": base, "@type": "RegistrationsBaseUrl/3.4.0" }] },
    {
      resources: [
        {
          "@id": "https://untrusted.example/hive/",
          "@type": "RegistrationsBaseUrl/3.6.0",
        },
      ],
    },
    {
      resources: [
        { "@id": base, "@type": "RegistrationsBaseUrl/3.6.0" },
        {
          "@id": "https://api.nuget.org/v3/other-hive/",
          "@type": "RegistrationsBaseUrl/3.6.0",
        },
      ],
    },
  ])("requires an unambiguous official SemVer2 resource", async (document) => {
    const { client, get } = fixture({ [service]: document });
    await expect(collectNuget(name, client)).rejects.toThrow(/NuGet/);
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([
    "https://untrusted.example/page.json",
    "https://private:token@api.nuget.org/v3/page.json",
    "http://api.nuget.org/v3/page.json",
    `${index}#page/1.0.0/1.0.0`,
  ])(
    "rejects an unsafe external page before trying to fetch it",
    async (pageUrl) => {
      const { items: _items, ...reference } = page([leaf("1.0.0")]);
      const { client, get } = fixture({
        [service]: serviceDocument,
        [index]: { count: 1, items: [{ ...reference, "@id": pageUrl }] },
      });
      await expect(collectNuget(name, client)).rejects.toThrow(/NuGet.*URL/);
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it("fails when a discovered page is missing instead of returning partial data", async () => {
    const { items: _items, ...reference } = page([leaf("1.0.0")]);
    const { client } = fixture({
      [service]: serviceDocument,
      [index]: {
        count: 1,
        items: [{ ...reference, "@id": `${base}missing-page.json` }],
      },
    });
    await expect(collectNuget(name, client)).rejects.toThrow(/NuGet request/);
  });

  it("rejects index counts, page counts, and boundaries that contradict the records", async () => {
    for (const document of [
      { count: 2, items: [page([leaf("1.0.0")])] },
      { count: 1, items: [{ ...page([leaf("1.0.0")]), count: 2 }] },
      { count: 1, items: [{ ...page([leaf("1.0.0")]), upper: "1.1.0" }] },
      {
        count: 1,
        items: [
          {
            ...page([leaf("1.0.0"), leaf("3.0.0"), leaf("2.0.0")]),
            upper: "2.0.0",
          },
        ],
      },
    ]) {
      const { client } = fixture({
        [service]: serviceDocument,
        [index]: document,
      });
      await expect(collectNuget(name, client)).rejects.toThrow(
        /NuGet.*count|NuGet.*bound/,
      );
    }
  });

  it("rejects repeated page identities and oversized page inventories", async () => {
    const same = page([leaf("1.0.0")]);
    for (const document of [
      { count: 2, items: [same, same] },
      { count: 513, items: Array.from({ length: 513 }, () => same) },
    ]) {
      const { client, get } = fixture({
        [service]: serviceDocument,
        [index]: document,
      });
      await expect(collectNuget(name, client)).rejects.toThrow(/NuGet.*page/);
      expect(get).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects wrong-package and malformed catalog records", async () => {
    for (const item of [
      leaf("1.0.0", { id: "Other.Package" }),
      leaf("1.0.0", { listed: "false" }),
      leaf("1.0.0", { version: "invalid version" }),
      {
        ...leaf("1.0.0"),
        catalogEntry: "https://api.nuget.org/v3/catalog0/entry.json",
      },
    ]) {
      const descriptor = { ...page([leaf("1.0.0")]), items: [item] };
      const { client } = fixture({
        [service]: serviceDocument,
        [index]: { count: 1, items: [descriptor] },
      });
      await expect(collectNuget(name, client)).rejects.toThrow(/NuGet/);
    }
  });

  it("rejects a fetched page whose descriptor changed", async () => {
    const external = `${base}page.json`;
    const full = { ...page([leaf("1.0.0")]), "@id": external };
    const { items: _items, ...reference } = full;
    const { client } = fixture({
      [service]: serviceDocument,
      [index]: { count: 1, items: [reference] },
      [external]: { ...full, upper: "2.0.0" },
    });
    await expect(collectNuget(name, client)).rejects.toThrow(/NuGet.*bound/);
  });

  it("validates IDs before requests and rejects malformed/failed responses", async () => {
    const { client, get } = fixture({});
    await expect(collectNuget("../unsafe", client)).rejects.toThrow(
      /NuGet package ID/,
    );
    await expect(collectNuget(`${name}\n`, client)).rejects.toThrow(
      /NuGet package ID/,
    );
    expect(get).not.toHaveBeenCalled();
    get.mockResolvedValueOnce({
      url: service,
      status: 503,
      observedAt: published,
      body: "private upstream message",
    });
    await expect(collectNuget(name, client)).rejects.toThrow(
      /NuGet request returned HTTP 503/,
    );
    get.mockResolvedValueOnce({
      url: service,
      status: 200,
      observedAt: published,
      body: "{broken",
    });
    await expect(collectNuget(name, client)).rejects.toThrow(
      /NuGet response.*JSON/,
    );
  });
});
