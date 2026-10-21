// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessCompatibility } from "../../../scripts/compatibility-audit/snapshot";
import type {
  Inventory,
  LibraryMapping,
  Registry,
  SavedFileReader,
  VariantMapping,
} from "../../../scripts/compatibility-audit/types";
import * as scoring from "../compatibility-score";

const AS_OF = "2026-09-30T15:00:00Z";
const PACKAGE_PATH = "showcase/integrations/example/package.json";
const CSPROJ_PATH = "showcase/integrations/example/agent/Agent.csproj";

function library(
  name: string,
  overrides: Partial<LibraryMapping> = {},
): LibraryMapping {
  return {
    name,
    registry: "npm",
    role: "framework",
    required: true,
    reason: "Selected framework library",
    source: { kind: "npm", path: PACKAGE_PATH },
    releasePolicy: "stable",
    ...overrides,
  };
}

function variant(
  libraries: LibraryMapping[],
  overrides: Partial<VariantMapping> = {},
): VariantMapping {
  return {
    slug: "example",
    language: "typescript",
    libraries,
    excludedLibraries: [],
    ...overrides,
  };
}

function inventory(
  name: string,
  versions = ["1.2.0"],
  registry: Registry = "npm",
): Inventory {
  return {
    registry,
    name,
    sourceUrl: `https://registry.example.test/${encodeURIComponent(name)}`,
    releases: versions.map((version) => ({
      version,
      timestamp: "2026-09-01T00:00:00Z",
      timestampKind: "published",
      eligible: true,
    })),
    complete: true,
    diagnostics: [],
  };
}

function savedFiles(files: Record<string, string>): SavedFileReader {
  return (path) => {
    if (!Object.prototype.hasOwnProperty.call(files, path))
      throw new Error(`Unexpected saved file read: ${path}`);
    return files[path];
  };
}

function npmSources(dependencies: Record<string, string>): SavedFileReader {
  return savedFiles({ [PACKAGE_PATH]: JSON.stringify({ dependencies }) });
}

function assess(
  mapping: VariantMapping[],
  inventories: Inventory[],
  read: SavedFileReader,
  asOf = AS_OF,
) {
  return assessCompatibility({
    sourceSha: "a".repeat(40),
    asOf,
    mapping,
    inventories,
    read,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("source compatibility assessment", () => {
  it("keeps an unknown required transitive dependency in the variant minimum", () => {
    const core = library("Microsoft.Agents.AI", {
      registry: "nuget",
      source: { kind: "csproj", path: CSPROJ_PATH, transitive: true },
    });
    const harness = library("Microsoft.Agents.AI.Harness", {
      registry: "nuget",
      source: { kind: "csproj", path: CSPROJ_PATH },
    });
    const result = assess(
      [variant([core, harness], { language: "dotnet" })],
      [
        inventory(core.name.toLowerCase(), ["1.0.0"], "nuget"),
        inventory(harness.name, ["1.0.0"], "nuget"),
      ],
      savedFiles({
        [CSPROJ_PATH]: `<Project><ItemGroup><PackageReference Include="${harness.name}" Version="1.0.0" /></ItemGroup></Project>`,
      }),
    );
    expect(result.snapshot.rows[0]).toMatchObject({
      currentScore: null,
      status: "not_verified",
      packages: [
        { name: core.name, runningVersion: null, compatibilityScore: null },
        { name: harness.name, compatibilityScore: 100 },
      ],
    });
    expect(result.packages[0]).toMatchObject({
      sourcePath: CSPROJ_PATH,
      required: true,
      sourceFact: { version: null, basis: "unknown" },
      scoreReason: "running-version-unknown",
    });
  });

  it("preserves source-lock provenance and source-only status", () => {
    const lockPath = "showcase/integrations/example/package-lock.json";
    const result = assess(
      [
        variant([
          library("framework", {
            source: { kind: "npm", path: PACKAGE_PATH, lockPath },
          }),
        ]),
      ],
      [inventory("framework")],
      savedFiles({
        [PACKAGE_PATH]: JSON.stringify({
          dependencies: { framework: "^1.0.0" },
        }),
        [lockPath]: JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { framework: "^1.0.0" } },
            "node_modules/framework": { version: "1.1.0" },
          },
        }),
      }),
    );
    expect(result.snapshot.rows[0]).toMatchObject({
      currentScore: 89,
      status: "source_declared_prototype_scored",
    });
    expect(result.packages[0]).toMatchObject({
      sourcePath: PACKAGE_PATH,
      lockPath,
      sourceFact: { version: "1.1.0", basis: "source-lock" },
      selectedRelease: {
        version: "1.2.0",
        timestamp: "2026-09-01T00:00:00Z",
        timestampKind: "published",
      },
      scoreReason: "scored",
    });
  });

  it("keeps a ranged declaration unknown and distinguishes policy unavailable", () => {
    const incomplete = { ...inventory("known"), complete: false };
    const result = assess(
      [variant([library("known"), library("missing")])],
      [incomplete, inventory("missing")],
      npmSources({ known: "1.0.0", missing: "^1.0.0" }),
    );
    expect(result.snapshot.rows[0].status).toBe("not_verified");
    expect(result.packages[0]).toMatchObject({
      scoreReason: "release-selection-unavailable",
      selection: { unavailableReason: "Release inventory is incomplete" },
    });
    expect(result.packages[1]).toMatchObject({
      sourceFact: { version: null, basis: "unknown" },
      scoreReason: "running-version-unknown",
    });
  });

  it("distinguishes a known but unscorable source version", () => {
    const result = assess(
      [variant([library("framework")])],
      [inventory("framework", ["1.2.0"])],
      npmSources({ framework: "1.3.0" }),
    );
    expect(result.snapshot.rows[0]).toMatchObject({
      currentScore: null,
      status: "policy_pending_or_incomplete_package_score",
    });
    expect(result.packages[0]).toMatchObject({
      sourceFact: { version: "1.3.0", basis: "source-declared" },
      scoreReason: "version-comparison-unscorable",
    });
  });

  it("marks tied minima and passes the full preview trains to the scorer", () => {
    const aggregate = vi.spyOn(scoring, "aggregateCompatibilityScores");
    const tied = assess(
      [variant([library("first"), library("second"), library("current")])],
      [
        inventory("first", ["1.2.0"]),
        inventory("second", ["1.4.0"]),
        inventory("current", ["1.0.0"]),
      ],
      npmSources({ first: "1.0.0", second: "1.2.0", current: "1.0.0" }),
    );
    expect(aggregate).toHaveBeenCalledWith([80, 80, 100]);
    expect(
      tied.snapshot.rows[0].packages.map((pkg) => pkg.setsVariantScore),
    ).toEqual([true, true, false]);

    const score = vi.spyOn(scoring, "scoreCompatibilityVersion");
    const name = "Microsoft.Agents.AI.Harness";
    const versions = [
      "1.0.0-preview.260101.1",
      "1.0.0-preview.260201.1",
      "1.0.0-preview.260301.2",
    ];
    const preview = assess(
      [
        variant([
          library(name, {
            registry: "nuget",
            releasePolicy: "stable-or-ms-preview",
            source: { kind: "csproj", path: CSPROJ_PATH },
          }),
        ]),
      ],
      [inventory(name, versions, "nuget")],
      savedFiles({
        [CSPROJ_PATH]: `<Project><ItemGroup><PackageReference Include="${name}" Version="${versions[0]}" /></ItemGroup></Project>`,
      }),
    );
    expect(score).toHaveBeenCalledWith({
      runningVersion: versions[0],
      latest: versions[2],
      previewTrains: [
        "1.preview.260101",
        "1.preview.260201",
        "1.preview.260301",
      ],
    });
    expect(preview.packages[0].selection.previewTrains).toHaveLength(3);
  });

  it("retains Maven selected-release timestamp provenance", () => {
    const name = "org.example:framework";
    const pom = "showcase/integrations/example/pom.xml";
    const target = inventory(name, ["1.2.0"], "maven");
    target.releases[0].timestampKind = "registry-last-updated";
    const result = assess(
      [
        variant([
          library(name, {
            registry: "maven",
            source: { kind: "pom", path: pom },
          }),
        ]),
      ],
      [target],
      savedFiles({
        [pom]:
          "<project><dependencies><dependency><groupId>org.example</groupId><artifactId>framework</artifactId><version>1.0.0</version></dependency></dependencies></project>",
      }),
    );
    expect(result.packages[0].selectedRelease).toMatchObject({
      timestampKind: "registry-last-updated",
    });
  });

  it("keeps exclusions, normalized names, ordering and deterministic dates", () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Assessment must not consult the current clock");
    });
    const requirements = "showcase/integrations/example/requirements.txt";
    const mapping = [
      variant(
        [
          library("Demo_Framework", {
            registry: "pypi",
            source: { kind: "requirements", path: requirements },
          }),
        ],
        {
          slug: "z-variant",
          excludedLibraries: [{ name: "provider", reason: "Generic client" }],
        },
      ),
      variant([], { slug: "built-in-agent", excludedReason: "Internal" }),
      variant([library("last-library")], { slug: "a-variant" }),
    ];
    const inventories = [
      inventory("last-library"),
      inventory("demo-framework", ["1.2.0"], "pypi"),
    ];
    const read = savedFiles({
      [requirements]: "Demo_Framework==1.0.0\n",
      [PACKAGE_PATH]: JSON.stringify({
        dependencies: { "last-library": "1.0.0" },
      }),
    });
    const first = assess(mapping, inventories, read, "2026-10-01T00:30:00Z");
    const second = assess(
      mapping,
      [...inventories].toReversed(),
      read,
      "2026-10-01T00:30:00Z",
    );
    expect(first).toEqual(second);
    expect(first.snapshot).toMatchObject({
      date: "October 1, 2026",
      assessedAt: "2026-10-01T00:30:00Z",
    });
    expect(first.snapshot.rows.map((row) => row.slug)).toEqual([
      "z-variant",
      "a-variant",
    ]);
    expect(first.packages[0]).toMatchObject({
      name: "Demo_Framework",
      sourceFact: { version: "1.0.0", basis: "source-declared" },
    });
  });

  it("rejects duplicate or missing registry identities", () => {
    expect(() =>
      assess(
        [],
        [
          inventory("Demo__Framework", ["1.0.0"], "pypi"),
          inventory("demo.framework", ["1.0.0"], "pypi"),
        ],
        savedFiles({}),
      ),
    ).toThrow(/Duplicate release inventory/);
    expect(() =>
      assess(
        [variant([library("framework")])],
        [inventory("framework", ["1.0.0"], "pypi")],
        npmSources({ framework: "1.0.0" }),
      ),
    ).toThrow("Missing release inventory for npm:framework");
  });
});
