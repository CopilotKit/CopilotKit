// @vitest-environment node

import { describe, expect, it } from "vitest";
import { selectRelease } from "../../../scripts/compatibility-audit/releases";
import { collectNuget } from "../../../scripts/compatibility-audit/registries/nuget";
import { collectPypi } from "../../../scripts/compatibility-audit/registries/pypi";
import type {
  HttpClient,
  Inventory,
  Registry,
} from "../../../scripts/compatibility-audit/types";

const cutoff = "2026-09-30T15:00:00Z";

function inventory(
  registry: Registry,
  versions: Array<
    [version: string, timestamp: string | null, eligible?: boolean]
  >,
  name = "example",
): Inventory {
  return {
    registry,
    name,
    sourceUrl: "https://example.test/registry",
    complete: true,
    diagnostics: [],
    releases: versions.map(([version, timestamp, eligible = true]) => ({
      version,
      timestamp,
      timestampKind: "published",
      eligible,
    })),
  };
}

async function nugetInventory(
  versions: Array<[version: string, published: string]>,
) {
  const name = "Microsoft.Agents.AI.Harness";
  const serviceUrl = "https://api.nuget.org/v3/index.json";
  const base = "https://api.nuget.org/v3/registration-test-semver2/";
  const indexUrl = `${base}${name.toLowerCase()}/index.json`;
  const documents: Record<string, unknown> = {
    [serviceUrl]: {
      version: "3.0.0",
      resources: [{ "@id": base, "@type": "RegistrationsBaseUrl/3.6.0" }],
    },
    [indexUrl]: {
      count: 1,
      items: [
        {
          "@id": `${indexUrl}#page/0`,
          count: versions.length,
          lower: versions[0][0],
          upper: versions[versions.length - 1][0],
          parent: indexUrl,
          items: versions.map(([version, published]) => ({
            "@id": `${base}${name.toLowerCase()}/${version.toLowerCase()}.json`,
            catalogEntry: {
              "@id": `https://api.nuget.org/v3/catalog0/data/example/${version.toLowerCase()}.json`,
              id: name,
              version,
              published,
            },
          })),
        },
      ],
    },
  };
  const client: HttpClient = {
    async get(url) {
      if (!Object.prototype.hasOwnProperty.call(documents, url))
        throw new Error(`Unexpected fixture request ${url}`);
      return {
        url,
        status: 200,
        observedAt: cutoff,
        body: JSON.stringify(documents[url]),
      };
    },
  };
  return collectNuget(name, client);
}

async function pypiInventory(
  versions: Array<[version: string, uploaded: string]>,
) {
  const name = "example";
  const sourceUrl = `https://pypi.org/simple/${name}/`;
  const client: HttpClient = {
    async get(url) {
      if (url !== sourceUrl)
        throw new Error(`Unexpected fixture request ${url}`);
      return {
        url,
        status: 200,
        observedAt: cutoff,
        body: JSON.stringify({
          meta: { "api-version": "1.1" },
          name,
          versions: versions.map(([version]) => version),
          files: versions.map(([version, uploaded]) => ({
            filename: `${name}-${version}-py3-none-any.whl`,
            "upload-time": uploaded,
            yanked: false,
          })),
        }),
      };
    },
  };
  return collectPypi(name, client);
}

describe("registry release selection", () => {
  it("uses eligible releases at or before the exact cutoff, independent of input order", () => {
    const releases = inventory("npm", [
      ["2.0.0", "2026-09-30T15:00:01Z"],
      ["1.9.0", cutoff],
      ["1.8.0", "2026-09-01T00:00:00Z"],
      ["3.0.0", "2026-09-01T00:00:00Z", false],
    ]);
    expect(selectRelease(releases, "stable", cutoff)).toEqual({
      latest: "1.9.0",
      previewTrains: [],
      unavailableReason: null,
    });
  });

  it("orders known stable ecosystem suffixes and keeps original version strings", () => {
    const cases: Array<[Inventory, string]> = [
      [
        inventory("npm", [
          ["2.0.0-rc.1", cutoff],
          ["1.9.0+build.2", cutoff],
          ["1.8.0", cutoff],
        ]),
        "1.9.0+build.2",
      ],
      [
        inventory("pypi", [
          ["1.9.9", cutoff],
          ["1!1.0.post2", cutoff],
          ["1!1.0", cutoff],
        ]),
        "1!1.0.post2",
      ],
      [
        inventory("nuget", [
          ["1.2.3", cutoff],
          ["1.2.3.1", cutoff],
          ["1.2.3.0", cutoff],
        ]),
        "1.2.3.1",
      ],
      [
        inventory("maven", [
          ["1.2.0-GA", cutoff],
          ["1.2.0-SP1", cutoff],
          ["1.1.9", cutoff],
        ]),
        "1.2.0-SP1",
      ],
    ];
    for (const [releases, expected] of cases) {
      expect(selectRelease(releases, "stable", cutoff).latest).toBe(expected);
    }
  });

  it("prefers stable over previews, including for an approved Microsoft package", () => {
    const releases = inventory(
      "nuget",
      [
        ["2.0.0-preview.260929.1", "2026-09-29T00:00:00Z"],
        ["1.0.0", "2026-09-01T00:00:00Z"],
      ],
      "Microsoft.Agents.AI",
    );
    expect(selectRelease(releases, "stable-or-ms-preview", cutoff)).toEqual({
      latest: "1.0.0",
      previewTrains: [],
      unavailableReason: null,
    });
  });

  it("returns distinct full dated Microsoft train IDs and the highest revision", () => {
    const releases = inventory(
      "nuget",
      [
        ["1.0.0-preview.260201.1", "2026-02-01T00:00:00Z"],
        ["1.0.0-preview.260201.2", "2026-02-02T00:00:00Z"],
        ["1.0.0-preview.260304.1", "2026-03-04T00:00:00Z"],
        ["1.0.0-preview.260305.1", "2026-10-01T00:00:00Z"],
        ["1.0.0-rc3", "2026-09-01T00:00:00Z"],
      ],
      "Microsoft.Agents.AI.Hosting",
    );
    expect(selectRelease(releases, "stable-or-ms-preview", cutoff)).toEqual({
      latest: "1.0.0-preview.260304.1",
      previewTrains: ["1.preview.260201", "1.preview.260304"],
      unavailableReason: null,
    });
    expect(selectRelease(releases, "stable", cutoff).latest).toBeNull();
    expect(
      selectRelease(
        { ...releases, name: "Other.Package" },
        "stable-or-ms-preview",
        cutoff,
      ).latest,
    ).toBeNull();
  });

  it("selects stable versions from NuGet collector timestamps with +00:00", async () => {
    const published = "2026-09-11T16:57:28.753+00:00";
    const releases = await nugetInventory([
      ["1.20.0", "2026-09-01T00:00:00+00:00"],
      ["1.21.0+build.7", published],
    ]);
    expect(releases.complete).toBe(true);
    expect(releases.releases[1].timestamp).toBe(published);
    expect(selectRelease(releases, "stable", cutoff)).toEqual({
      latest: "1.21.0+build.7",
      previewTrains: [],
      unavailableReason: null,
    });
  });

  it("selects PyPI uploads before and at a cutoff without admitting a later microsecond", async () => {
    const uploads: Array<[string, string]> = [
      ["1.0.0", "2026-09-30T14:59:59.999999Z"],
      ["1.1.0", "2026-09-30T15:00:00.000000Z"],
      ["1.2.0", "2026-09-30T15:00:00.000001Z"],
      ["1.3.0", "2026-09-30T15:00:00.000002Z"],
    ];
    const releases = await pypiInventory(uploads);
    expect(releases.complete).toBe(true);
    expect(releases.releases.map(({ timestamp }) => timestamp)).toEqual(
      uploads.map(([, uploaded]) => uploaded),
    );
    expect(selectRelease(releases, "stable", cutoff)).toEqual({
      latest: "1.1.0",
      previewTrains: [],
      unavailableReason: null,
    });
    expect(
      selectRelease(releases, "stable", "2026-09-30T15:00:00.000001Z"),
    ).toEqual({
      latest: "1.2.0",
      previewTrains: [],
      unavailableReason: null,
    });
  });

  it("selects dated Microsoft previews from NuGet collector offset timestamps", async () => {
    const releases = await nugetInventory([
      ["1.0.0-preview.260911.1", "2026-09-11T16:57:28.753+00:00"],
      ["1.0.0-preview.260930.2", "2026-09-30T14:59:59+00:00"],
      ["1.0.0-preview.260930.3", "2026-09-30T15:00:01+00:00"],
    ]);
    expect(releases.complete).toBe(true);
    expect(selectRelease(releases, "stable-or-ms-preview", cutoff)).toEqual({
      latest: "1.0.0-preview.260930.2",
      previewTrains: ["1.preview.260911", "1.preview.260930"],
      unavailableReason: null,
    });
  });

  it("compares NuGet offsets by absolute time across the exact cutoff and date rollover", async () => {
    const releases = await nugetInventory([
      ["1.0.0", "2026-09-30T07:59:59.999-07:00"],
      ["1.1.0", "2026-09-30T20:30:00+05:30"],
      ["1.2.0", "2026-09-30T08:00:00.001-07:00"],
      ["1.3.0", "2026-10-01T00:00:00+09:00"],
      ["1.4.0", "2026-10-01T00:00:00.001+09:00"],
      ["1.5.0", "2026-10-01T00:00:00.000001+09:00"],
    ]);
    expect(releases.complete).toBe(true);
    expect(selectRelease(releases, "stable", cutoff)).toEqual({
      latest: "1.3.0",
      previewTrains: [],
      unavailableReason: null,
    });
  });

  it("does not replace an unsupported possibly latest stable form with an older target", () => {
    for (const [registry, version] of [
      ["npm", "2.0.0.1"],
      ["pypi", "2.0+private"],
      ["maven", "2.0.0-unknown"],
    ] as const) {
      const releases = inventory(registry, [
        ["1.0.0", cutoff],
        [version, cutoff],
      ]);
      expect(selectRelease(releases, "stable", cutoff)).toMatchObject({
        latest: null,
        previewTrains: [],
        unavailableReason: expect.stringMatching(/Cannot order/),
      });
    }
  });

  it.each(["2.0.0-RC1", "2.0.0-M1", "2.0.0-SNAPSHOT"])(
    "excludes known Maven preview %s under stable policy",
    (version) => {
      expect(
        selectRelease(
          inventory("maven", [
            ["1.0.0", cutoff],
            [version, cutoff],
          ]),
          "stable",
          cutoff,
        ),
      ).toEqual({
        latest: "1.0.0",
        previewTrains: [],
        unavailableReason: null,
      });
    },
  );

  it.each(["2.0.0-vendor.rc1", "2.0.0-RC1-vendor"])(
    "keeps possibly latest Maven release %s with an unknown compound qualifier unresolved",
    (version) => {
      const releases = inventory("maven", [
        ["1.0.0", cutoff],
        [version, cutoff],
      ]);
      expect(selectRelease(releases, "stable", cutoff)).toEqual({
        latest: null,
        previewTrains: [],
        unavailableReason: `Cannot order possibly latest release ${version}`,
      });
    },
  );

  it("makes incomplete inventory and invalid candidate timestamps unavailable", () => {
    const complete = inventory("npm", [["1.0.0", cutoff]]);
    expect(
      selectRelease({ ...complete, complete: false }, "stable", cutoff)
        .unavailableReason,
    ).toMatch(/incomplete/);
    expect(
      selectRelease(inventory("npm", [["1.0.0", null]]), "stable", cutoff)
        .unavailableReason,
    ).toMatch(/timestamp/);
    expect(
      selectRelease(
        inventory("npm", [["1.0.0", "2026-02-30T00:00:00Z"]]),
        "stable",
        cutoff,
      ).unavailableReason,
    ).toMatch(/timestamp/);
    expect(
      selectRelease(complete, "stable", "2026-02-30T00:00:00Z")
        .unavailableReason,
    ).toMatch(/as-of/);
  });

  it.each([
    "2026-02-30T00:00:00+00:00",
    "2026-02-30T00:00:00.000001+00:00",
    "2025-02-29T00:00:00-07:00",
    "2026-09-30T24:00:00+00:00",
    "2026-09-30T15:00:00+24:00",
    "2026-09-30T15:00:00+05:60",
    "2026-09-30T15:00:00+0000",
    "2026-09-30T15:00:00",
    "2026-09-30T15:00:00+00:00\n",
  ])("rejects invalid calendar or offset timestamps: %s", (value) => {
    const releases = inventory("nuget", [["1.0.0", value]]);
    expect(selectRelease(releases, "stable", cutoff).unavailableReason).toMatch(
      /timestamp/,
    );
    expect(
      selectRelease(inventory("nuget", [["1.0.0", cutoff]]), "stable", value)
        .unavailableReason,
    ).toMatch(/as-of/);
  });

  it("does not invent a target when no release is eligible by the cutoff", () => {
    const releases = inventory("npm", [["1.0.0", "2026-10-01T00:00:00Z"]]);
    expect(selectRelease(releases, "stable", cutoff)).toMatchObject({
      latest: null,
      unavailableReason: expect.stringMatching(/No eligible/),
    });
  });
});
