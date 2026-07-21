import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { usePackedArtifacts } from "./use-packed-artifacts.mjs";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "packed-host-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("replaces workspace dependencies and source aliases with packed artifacts", () => {
  const root = temporaryDirectory();
  const host = join(root, "host");
  const artifacts = join(root, "artifacts");
  mkdirSync(host);
  mkdirSync(artifacts);
  writeFileSync(
    join(host, "package.json"),
    `${JSON.stringify({
      name: "host",
      dependencies: {
        "@copilotkit/angular": "workspace:*",
        "@copilotkit/core": "workspace:^",
        rxjs: "7.8.2",
      },
    })}\n`,
  );
  writeFileSync(
    join(host, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        paths: {
          "@copilotkit/angular": ["../../packages/angular/src/index.ts"],
          "@copilotkit/angular/*": ["../../packages/angular/src/*"],
          "local-only": ["src/local.ts"],
        },
      },
    })}\n`,
  );
  for (const filename of ["angular.tgz", "core.tgz"]) {
    writeFileSync(join(artifacts, filename), filename);
  }
  writeFileSync(
    join(artifacts, "artifacts.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entryPackage: "@copilotkit/angular",
      packages: {
        "@copilotkit/angular": "angular.tgz",
        "@copilotkit/core": "core.tgz",
      },
    })}\n`,
  );

  usePackedArtifacts({ hostDirectory: host, artifactDirectory: artifacts });

  const manifest = JSON.parse(
    readFileSync(join(host, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
  };
  expect(manifest.dependencies).toEqual({
    "@copilotkit/angular": `file:${join(artifacts, "angular.tgz")}`,
    "@copilotkit/core": `file:${join(artifacts, "core.tgz")}`,
    rxjs: "7.8.2",
  });
  expect(readFileSync(join(host, "pnpm-workspace.yaml"), "utf8")).toBe(
    [
      'packages: ["."]',
      "overrides:",
      `  '@copilotkit/angular': 'file:${join(artifacts, "angular.tgz")}'`,
      `  '@copilotkit/core': 'file:${join(artifacts, "core.tgz")}'`,
      "",
    ].join("\n"),
  );
  expect(JSON.parse(readFileSync(join(host, "tsconfig.json"), "utf8"))).toEqual(
    { compilerOptions: { paths: { "local-only": ["src/local.ts"] } } },
  );
});

test("fails when a workspace dependency has no packed artifact", () => {
  const root = temporaryDirectory();
  const host = join(root, "host");
  const artifacts = join(root, "artifacts");
  mkdirSync(host);
  mkdirSync(artifacts);
  writeFileSync(
    join(host, "package.json"),
    `${JSON.stringify({
      dependencies: { "@copilotkit/angular": "workspace:*" },
    })}\n`,
  );
  writeFileSync(join(host, "tsconfig.json"), "{}\n");
  writeFileSync(
    join(artifacts, "artifacts.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entryPackage: "@copilotkit/angular",
      packages: {},
    })}\n`,
  );

  expect(() =>
    usePackedArtifacts({ hostDirectory: host, artifactDirectory: artifacts }),
  ).toThrow(/no packed artifact/);
});
