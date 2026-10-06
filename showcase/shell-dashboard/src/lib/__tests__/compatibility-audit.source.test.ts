// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureSourceFiles,
  resolveOriginMain,
  resolveSourceFact,
} from "../../../scripts/compatibility-audit/source";
import type {
  LibraryMapping,
  VariantMapping,
} from "../../../scripts/compatibility-audit/types";

const manifest = "showcase/integrations/example/manifest.yaml";
const requirements = "showcase/integrations/example/requirements.txt";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): { repo: string; sha: string } {
  const repo = mkdtempSync(join(tmpdir(), "compatibility-source-"));
  roots.push(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], {
    cwd: repo,
  });
  for (const [path, body] of Object.entries(files)) {
    const target = join(repo, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  execFileSync("git", ["add", "--all"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: repo });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  return { repo, sha };
}

function library(
  kind: LibraryMapping["source"]["kind"],
  path: string,
  name = "framework",
): LibraryMapping {
  return {
    name,
    registry:
      kind === "requirements"
        ? "pypi"
        : kind === "csproj"
          ? "nuget"
          : kind === "pom"
            ? "maven"
            : "npm",
    role: "framework",
    required: true,
    reason: "fixture framework",
    source: { kind, path },
    releasePolicy: "stable",
  };
}

function mapping(
  source = library("requirements", requirements),
): VariantMapping[] {
  return [
    {
      slug: "example",
      language: "python",
      libraries: [source],
      excludedLibraries: [],
    },
  ];
}

describe("pinned source capture", () => {
  it("captures committed source bytes despite later worktree edits", () => {
    const { repo, sha } = fixture({
      [manifest]: "slug: example\n",
      [requirements]: "framework==1.2.3\n",
    });
    writeFileSync(join(repo, manifest), "slug: changed\n");
    writeFileSync(join(repo, requirements), "framework==9.9.9\n");

    expect(captureSourceFiles(repo, sha, mapping())).toEqual([
      { path: requirements, body: "framework==1.2.3\n" },
    ]);
  });

  it("resolves only the local origin/main tracking ref to one full commit", () => {
    const { repo, sha } = fixture({
      [manifest]: "slug: example\n",
      [requirements]: "framework==1.2.3\n",
    });
    expect(() => resolveOriginMain(repo)).toThrow(
      /Pinned Git source command failed/,
    );
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", sha], {
      cwd: repo,
    });
    writeFileSync(join(repo, requirements), "framework==9.9.9\n");
    execFileSync("git", ["add", "--all"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "newer local HEAD"], {
      cwd: repo,
    });
    expect(resolveOriginMain(repo)).toBe(sha);
    expect(
      captureSourceFiles(repo, resolveOriginMain(repo), mapping()),
    ).toEqual([{ path: requirements, body: "framework==1.2.3\n" }]);
  });

  it("captures a pinned source filename containing a newline", () => {
    const sourcePath = "showcase/integrations/example/requirements\npart.txt";
    const body = "framework==1.2.3\n";
    const { repo, sha } = fixture({
      [manifest]: "slug: example\n",
      [sourcePath]: body,
    });

    expect(
      captureSourceFiles(
        repo,
        sha,
        mapping(library("requirements", sourcePath)),
      ),
    ).toContainEqual({ path: sourcePath, body });
  });

  it("ignores replacement refs for a committed source blob", () => {
    const original = "framework==1.2.3\n";
    const replacement = "framework==9.9.9\n";
    const { repo, sha } = fixture({
      [manifest]: "slug: example\n",
      [requirements]: original,
    });
    const originalBlob = execFileSync(
      "git",
      ["rev-parse", `${sha}:${requirements}`],
      { cwd: repo, encoding: "utf8" },
    ).trim();
    const replacementBlob = execFileSync(
      "git",
      ["hash-object", "-w", "--stdin"],
      { cwd: repo, encoding: "utf8", input: replacement },
    ).trim();
    execFileSync("git", ["replace", originalBlob, replacementBlob], {
      cwd: repo,
    });

    expect(
      execFileSync("git", ["show", `${sha}:${requirements}`], {
        cwd: repo,
        encoding: "utf8",
      }),
    ).toBe(replacement);
    expect(captureSourceFiles(repo, sha, mapping())).toContainEqual({
      path: requirements,
      body: original,
    });
  });

  it("requires a full existing commit SHA", () => {
    const { repo, sha } = fixture({
      [manifest]: "slug: example\n",
      [requirements]: "framework==1.2.3\n",
    });
    expect(() => captureSourceFiles(repo, "HEAD", mapping())).toThrow(
      /full 40-digit Git commit SHA/,
    );
    expect(() => captureSourceFiles(repo, sha.slice(0, 8), mapping())).toThrow(
      /full 40-digit Git commit SHA/,
    );
    expect(() => captureSourceFiles(repo, "0".repeat(40), mapping())).toThrow(
      /Pinned Git source command failed/,
    );
    const blobSha = execFileSync("git", ["rev-parse", `HEAD:${requirements}`], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(() => captureSourceFiles(repo, blobSha, mapping())).toThrow(
      /Pinned Git source command failed/,
    );
  });

  it("rejects a mapping for which the pinned tree lacks a manifest", () => {
    const { repo, sha } = fixture({ [requirements]: "framework==1.2.3\n" });
    expect(() => captureSourceFiles(repo, sha, mapping())).toThrow(
      /Mapping roster differs from manifests/,
    );
  });

  it("rejects a missing mapped source or lockfile", () => {
    const { repo, sha } = fixture({ [manifest]: "slug: example\n" });
    expect(() => captureSourceFiles(repo, sha, mapping())).toThrow(
      /Pinned source file is missing or not regular: .*requirements\.txt/,
    );

    const npm = library("npm", "showcase/integrations/example/package.json");
    npm.source.lockPath = "showcase/integrations/example/package-lock.json";
    const other = fixture({
      [manifest]: "slug: example\n",
      [npm.source.path]: '{"dependencies":{"framework":"1.2.3"}}',
    });
    expect(() =>
      captureSourceFiles(other.repo, other.sha, mapping(npm)),
    ).toThrow(
      /Pinned source file is missing or not regular: .*package-lock\.json/,
    );
  });

  it("rejects added or stale manifest roster entries at that commit", () => {
    const added = fixture({
      [manifest]: "slug: example\n",
      [requirements]: "framework==1.2.3\n",
      "showcase/integrations/another/manifest.yaml": "slug: another\n",
    });
    expect(() => captureSourceFiles(added.repo, added.sha, mapping())).toThrow(
      /missing=another/,
    );

    const stale = fixture({
      [manifest]: "slug: example\n",
      [requirements]: "framework==1.2.3\n",
    });
    const policies = mapping();
    policies.push({
      slug: "another",
      language: "python",
      excludedReason: "excluded fixture",
      libraries: [],
      excludedLibraries: [],
    });
    expect(() => captureSourceFiles(stale.repo, stale.sha, policies)).toThrow(
      /stale=another/,
    );
  });
});

describe("saved source dispatcher", () => {
  it("routes each mapped source kind through its existing parser", () => {
    const contents = new Map([
      ["requirements.txt", "framework==1.2.3\n"],
      ["package.json", '{"dependencies":{"framework":"1.2.3"}}'],
      [
        "agent.csproj",
        '<Project><ItemGroup><PackageReference Include="framework" Version="1.2.3" /></ItemGroup></Project>',
      ],
      [
        "pom.xml",
        "<project><properties><framework.version>1.2.3</framework.version></properties><dependencyManagement><dependencies><dependency><groupId>example</groupId><artifactId>framework</artifactId><version>${framework.version}</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement></project>",
      ],
    ]);
    const read = (path: string): string => {
      const body = contents.get(path);
      if (body === undefined) throw new Error(`Missing saved source: ${path}`);
      return body;
    };
    const cases = [
      library("requirements", "requirements.txt"),
      library("npm", "package.json"),
      library("csproj", "agent.csproj"),
      {
        ...library("pom", "pom.xml", "example:framework"),
        source: {
          kind: "pom" as const,
          path: "pom.xml",
          property: "framework.version",
        },
      },
    ];
    for (const item of cases) {
      expect(resolveSourceFact(item, read)).toMatchObject({
        version: "1.2.3",
        basis: "source-declared",
      });
    }
  });
});
