import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  collectAngularWorkspacePackages,
  readAngularArtifactSet,
} from "./angular-artifacts.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "angular-artifacts-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writePackage(
  root: string,
  directory: string,
  manifest: Record<string, unknown>,
): void {
  const packageDirectory = join(root, "packages", directory);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest)}\n`,
  );
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("collects every transitive workspace package exactly once", () => {
  const root = temporaryDirectory();
  writePackage(root, "angular", {
    name: "@copilotkit/angular",
    version: "1.2.3",
    dependencies: {
      "@copilotkit/core": "workspace:*",
      "@copilotkit/shared": "workspace:^",
    },
  });
  writePackage(root, "core", {
    name: "@copilotkit/core",
    version: "1.2.3",
    dependencies: { "@copilotkit/shared": "workspace:*" },
  });
  writePackage(root, "shared", {
    name: "@copilotkit/shared",
    version: "1.2.3",
  });

  expect(collectAngularWorkspacePackages(root)).toEqual([
    "@copilotkit/angular",
    "@copilotkit/core",
    "@copilotkit/shared",
  ]);
});

test("reads a complete artifact set and rejects path traversal", () => {
  const directory = temporaryDirectory();
  writeFileSync(join(directory, "copilotkit-angular-1.2.3.tgz"), "angular");
  writeFileSync(join(directory, "copilotkit-core-1.2.3.tgz"), "core");
  writeFileSync(
    join(directory, "artifacts.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entryPackage: "@copilotkit/angular",
      packages: {
        "@copilotkit/angular": "copilotkit-angular-1.2.3.tgz",
        "@copilotkit/core": "copilotkit-core-1.2.3.tgz",
      },
    })}\n`,
  );

  expect(readAngularArtifactSet(directory)).toEqual({
    entryTarball: join(directory, "copilotkit-angular-1.2.3.tgz"),
    tarballs: new Map([
      ["@copilotkit/angular", join(directory, "copilotkit-angular-1.2.3.tgz")],
      ["@copilotkit/core", join(directory, "copilotkit-core-1.2.3.tgz")],
    ]),
  });

  writeFileSync(
    join(directory, "artifacts.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entryPackage: "@copilotkit/angular",
      packages: { "@copilotkit/angular": "../escape.tgz" },
    })}\n`,
  );
  expect(() => readAngularArtifactSet(directory)).toThrow(/safe tarball/);
});
