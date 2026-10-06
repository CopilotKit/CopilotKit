// @vitest-environment node
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, runAudit } from "../../../scripts/audit-compatibility";
import { collectAudit } from "../../../scripts/compatibility-audit/collect";
import type { CollectAdapters } from "../../../scripts/compatibility-audit/collect";
import { COMPATIBILITY_MAPPING } from "../../../scripts/compatibility-audit/mapping";
import type {
  CollectOptions,
  LibraryMapping,
  RawResponse,
} from "../../../scripts/compatibility-audit/types";

const SHA = "a".repeat(40);
const AS_OF = "2026-09-30T15:00:00Z";
const OBSERVED_AT = "2026-10-01T12:00:00.000Z";
const PUBLISHED = "2026-09-01T00:00:00Z";
const NUGET_SERVICE = "https://api.nuget.org/v3/index.json";
const NUGET_BASE = "https://api.nuget.org/v3/registration5-gz-semver2/";
const ORIGINAL_SNAPSHOT = `export const COMPATIBILITY_SNAPSHOT = {
  "date": "fixture", "assessedAt": "${AS_OF}", "methodology": "fixture", "rows": []
} satisfies {
  date: string;
  assessedAt: string;
  methodology: string;
  rows: CompatibilitySnapshotRow[];
};
`;
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function capturedSources(): { path: string; body: string }[] {
  const files = new Map<string, string>();
  const groups = new Map<string, LibraryMapping[]>();
  for (const variant of COMPATIBILITY_MAPPING) {
    for (const library of variant.libraries) {
      const group = groups.get(library.source.path) ?? [];
      group.push(library);
      groups.set(library.source.path, group);
    }
  }
  for (const [path, libraries] of groups) {
    const spec = libraries[0].source;
    if (spec.kind === "requirements") {
      files.set(path, libraries.map(({ name }) => `${name}==1.0.0`).join("\n"));
    } else if (spec.kind === "npm") {
      const dependencies = Object.fromEntries(
        libraries.map(({ name }) => [name, "1.0.0"]),
      );
      files.set(path, JSON.stringify({ name: "fixture", dependencies }));
      files.set(
        spec.lockPath!,
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies },
            ...Object.fromEntries(
              libraries.map(({ name }) => [
                `node_modules/${name}`,
                { version: "1.0.0" },
              ]),
            ),
          },
        }),
      );
    } else if (spec.kind === "csproj") {
      const direct = [
        "Microsoft.Agents.AI.Hosting.AGUI.AspNetCore",
        "Microsoft.Extensions.AI.OpenAI",
        "OpenAI",
        ...libraries
          .filter((library) => !library.source.transitive)
          .map(({ name }) => name),
      ];
      files.set(
        path,
        `<Project><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup><ItemGroup>${direct
          .map(
            (name) => `<PackageReference Include="${name}" Version="1.0.0" />`,
          )
          .join("")}</ItemGroup></Project>`,
      );
    } else {
      files.set(
        path,
        `<project>
        <properties><spring-ai.version>1.0.0</spring-ai.version></properties>
        <dependencyManagement><dependencies><dependency>
          <groupId>org.springframework.ai</groupId><artifactId>spring-ai-bom</artifactId>
          <version>\${spring-ai.version}</version><type>pom</type><scope>import</scope>
        </dependency></dependencies></dependencyManagement>
        <dependencies><dependency><groupId>org.springframework.ai</groupId>
          <artifactId>spring-ai-starter-model-openai</artifactId>
        </dependency></dependencies>
      </project>`,
      );
    }
  }
  return [...files].map(([path, body]) => ({ path, body }));
}

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "compatibility-cli-")),
  );
  directories.push(root);
  const snapshotPath = join(root, "compatibility-snapshot.ts");
  await writeFile(snapshotPath, ORIGINAL_SNAPSHOT);
  const responses = new Map<string, RawResponse>();
  const add = (url: string, value: unknown) =>
    responses.set(url, {
      url,
      status: 200,
      observedAt: OBSERVED_AT,
      body: typeof value === "string" ? value : JSON.stringify(value),
    });
  add(NUGET_SERVICE, {
    resources: [{ "@id": NUGET_BASE, "@type": "RegistrationsBaseUrl/3.6.0" }],
  });
  for (const variant of COMPATIBILITY_MAPPING) {
    if (variant.excludedReason) continue;
    for (const { name, registry } of variant.libraries.filter(
      (item) => item.required,
    )) {
      if (registry === "npm") {
        add(
          `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, "@")}`,
          {
            name,
            versions: { "1.0.0": { version: "1.0.0" } },
            time: { "1.0.0": PUBLISHED },
          },
        );
      } else if (registry === "pypi") {
        const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
        add(`https://pypi.org/simple/${normalized}/`, {
          name: normalized,
          meta: { "api-version": "1.1" },
          versions: ["1.0.0"],
          files: [
            {
              filename: `${normalized}-1.0.0.tar.gz`,
              "upload-time": PUBLISHED,
            },
          ],
        });
      } else if (registry === "nuget") {
        const index = `${NUGET_BASE}${name.toLowerCase()}/index.json`;
        const page = `${NUGET_BASE}${name.toLowerCase()}/page.json`;
        const descriptor = {
          "@id": page,
          count: 1,
          lower: "1.0.0",
          upper: "1.0.0",
        };
        add(index, { "@id": index, count: 1, items: [descriptor] });
        add(page, {
          ...descriptor,
          parent: index,
          items: [
            {
              "@id": `${NUGET_BASE}${name.toLowerCase()}/1.0.0.json`,
              catalogEntry: {
                id: name,
                version: "1.0.0",
                published: PUBLISHED,
                listed: true,
              },
            },
          ],
        });
      } else {
        const [group, artifact] = name.split(":");
        add(
          `https://repo1.maven.org/maven2/${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`,
          `<metadata><groupId>${group}</groupId><artifactId>${artifact}</artifactId>
            <versioning><versions><version>1.0.0</version></versions></versioning></metadata>`,
        );
        const url = new URL("https://central.sonatype.com/solrsearch/select");
        url.searchParams.set("q", `g:"${group}" AND a:"${artifact}"`);
        url.searchParams.set("core", "gav");
        url.searchParams.set("rows", "200");
        url.searchParams.set("start", "0");
        url.searchParams.set("wt", "json");
        add(url.href, {
          response: {
            numFound: 1,
            start: 0,
            docs: [
              {
                g: group,
                a: artifact,
                v: "1.0.0",
                timestamp: Date.parse(PUBLISHED),
              },
            ],
          },
        });
      }
    }
  }
  const get = vi.fn(async (url: string): Promise<RawResponse> => {
    const response = responses.get(url);
    if (!response) throw new Error(`Missing fixture response: ${url}`);
    return { ...response };
  });
  const capture = vi.fn(capturedSources);
  const options: CollectOptions = {
    asOf: AS_OF,
    out: join(root, "audit.json"),
  };
  const adapters: CollectAdapters = {
    repo: root,
    snapshotPath,
    captureSourceFiles: capture,
    httpClient: { get },
    resolveOriginMain: () => SHA,
    clock: () => new Date(OBSERVED_AT),
  };
  return {
    root,
    snapshotPath,
    responses,
    get,
    capture,
    options,
    adapters,
  };
}

describe("manual compatibility audit", () => {
  it("deduplicates registry requests and writes one report with source provenance", async () => {
    const f = await fixture();
    const result = await collectAudit(f.options, f.adapters);
    expect(f.capture).toHaveBeenCalledWith(f.root, SHA, COMPATIBILITY_MAPPING);
    expect(result.report).toMatchObject({
      schemaVersion: 1,
      source: { sha: SHA, label: "prototype-source" },
      asOf: AS_OF,
      snapshot: result.snapshot,
    });
    expect(result.packages).toHaveLength(
      COMPATIBILITY_MAPPING.reduce(
        (count, variant) => count + variant.libraries.length,
        0,
      ),
    );
    for (const slug of ["ms-agent-dotnet", "ms-agent-harness-dotnet"]) {
      const row = result.snapshot.rows.find((item) => item.slug === slug)!;
      expect(row.status).toBe("not_verified");
      expect(row.currentScore).toBeNull();
      expect(row.packages.map((pkg) => pkg.name)).toEqual(
        slug === "ms-agent-dotnet"
          ? ["Microsoft.Agents.AI"]
          : ["Microsoft.Agents.AI", "Microsoft.Agents.AI.Harness"],
      );
      for (const pkg of result.packages.filter((item) => item.slug === slug)) {
        const core = pkg.name === "Microsoft.Agents.AI";
        expect(pkg.lockPath).toBeNull();
        expect(pkg.sourceFact).toMatchObject({
          version: core ? null : "1.0.0",
          basis: core ? "unknown" : "source-declared",
          evidence: [pkg.sourcePath],
        });
        if (core) expect(pkg.sourceFact.reason).toMatch(/transitive/i);
      }
      expect(result.report.exclusions).toContainEqual(
        expect.objectContaining({
          slug,
          libraries: expect.arrayContaining([
            expect.objectContaining({ name: "Microsoft.Agents.AI.Hosting" }),
            expect.objectContaining({
              name: "Microsoft.Agents.AI.Hosting.AGUI.AspNetCore",
            }),
          ]),
        }),
      );
    }
    expect(new Set(result.packages.map((pkg) => pkg.registry))).toEqual(
      new Set(["npm", "pypi", "nuget", "maven"]),
    );
    expect(result.packages.find((pkg) => pkg.slug === "ag2")).toMatchObject({
      sourcePath: "showcase/integrations/ag2/requirements.txt",
      sourceFact: { version: "1.0.0", basis: "source-declared" },
      selectedRelease: { version: "1.0.0", timestampKind: "published" },
      compatibilityScore: 100,
    });
    expect(result.report.exclusions).toContainEqual(
      expect.objectContaining({
        slug: "built-in-agent",
        excludedReason: expect.any(String),
      }),
    );
    expect(f.get.mock.calls.map(([url]) => url).sort()).toEqual(
      [...f.responses.keys()].sort(),
    );
    expect(
      f.get.mock.calls.filter(([url]) => url === NUGET_SERVICE),
    ).toHaveLength(1);
    expect(result.report.observations).toContainEqual({
      url: NUGET_SERVICE,
      status: 200,
      observedAt: OBSERVED_AT,
    });
    const saved = await readFile(f.options.out, "utf8");
    expect(JSON.parse(saved)).toEqual(result.report);
    expect(saved).not.toContain('"body"');
    expect(await readFile(f.snapshotPath, "utf8")).toBe(ORIGINAL_SNAPSHOT);
    await expect(collectAudit(f.options, f.adapters)).rejects.toThrow(
      /already exists/,
    );
    expect(f.capture).toHaveBeenCalledTimes(1);
  });

  it("replaces the snapshot only after an explicit successful write", async () => {
    const f = await fixture();
    const result = await collectAudit(
      { ...f.options, writeSnapshot: true },
      f.adapters,
    );
    expect(JSON.parse(await readFile(f.options.out, "utf8"))).toEqual(
      result.report,
    );
    expect(await readFile(f.snapshotPath, "utf8")).not.toBe(ORIGINAL_SNAPSHOT);
    expect(await readFile(f.snapshotPath, "utf8")).toContain(
      '"source_declared_prototype_scored"',
    );
  });

  it("rejects obsolete, duplicate, malformed and unsafe CLI arguments before collection", async () => {
    for (const args of [
      [],
      ["collect", "--out", "/tmp/audit.json"],
      ["replay", "--audit-dir", "/tmp/audit"],
      ["--out", "relative.json"],
      ["--out", "/tmp/audit.json", "--versions", "source"],
      ["--out", "/tmp/audit.json", "--source-fallback"],
      ["--out", "/tmp/audit.json", "--railway-project", "project"],
      ["--out", "/tmp/audit.json", "--out", "/tmp/another.json"],
      ["--out", "/tmp/audit.json", "--as-of", "2026-02-30T00:00:00Z"],
      ["--out", "/tmp/audit.json", "--as-of", "2026-09-30"],
      ["--out", "/tmp/audit.json", "--write-snapshot", "--write-snapshot"],
    ]) {
      await expect(runAudit(args)).rejects.toThrow();
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main([])).toBe(1);
  });
});
