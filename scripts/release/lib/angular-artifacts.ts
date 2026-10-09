import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

export const ANGULAR_ENTRY_PACKAGE = "@copilotkit/angular";
export const ANGULAR_ARTIFACT_MANIFEST = "artifacts.json";

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface AngularArtifactManifest {
  schemaVersion: 1;
  entryPackage: typeof ANGULAR_ENTRY_PACKAGE;
  packages: Record<string, string>;
}

export interface AngularArtifactSet {
  entryTarball: string;
  tarballs: Map<string, string>;
}

function packageDirectory(root: string, name: string): string {
  return join(root, "packages", name.replace("@copilotkit/", ""));
}

function readPackageManifest(root: string, name: string): PackageManifest {
  const manifestPath = join(packageDirectory(root, name), "package.json");
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    value.name !== name ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    value.version.length === 0
  ) {
    throw new Error(`${manifestPath} does not describe ${name}`);
  }
  return value as PackageManifest;
}

function workspaceDependencies(manifest: PackageManifest): string[] {
  return [manifest.dependencies, manifest.peerDependencies]
    .flatMap((dependencies) => Object.entries(dependencies ?? {}))
    .filter(
      ([name, range]) =>
        name.startsWith("@copilotkit/") && range.startsWith("workspace:"),
    )
    .map(([name]) => name)
    .sort();
}

/** Return the deterministic transitive workspace graph packed for Angular. */
export function collectAngularWorkspacePackages(root: string): string[] {
  const packages: string[] = [];
  const queued = [ANGULAR_ENTRY_PACKAGE];
  const seen = new Set<string>(queued);

  while (queued.length > 0) {
    const name = queued.shift();
    if (!name) break;
    packages.push(name);
    for (const dependency of workspaceDependencies(
      readPackageManifest(root, name),
    )) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      queued.push(dependency);
    }
  }

  return packages;
}

function tarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

/** Pack the already-built Angular workspace graph and write its manifest. */
export function packAngularArtifacts(
  root: string,
  outputDirectory: string,
): AngularArtifactSet {
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: true });
  const packages: Record<string, string> = {};

  for (const name of collectAngularWorkspacePackages(root)) {
    const manifest = readPackageManifest(root, name);
    execFileSync("pnpm", ["pack", "--pack-destination", output], {
      cwd: packageDirectory(root, name),
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, CI: "true" },
    });
    packages[name] = tarballName(manifest);
  }

  const artifactManifest: AngularArtifactManifest = {
    schemaVersion: 1,
    entryPackage: ANGULAR_ENTRY_PACKAGE,
    packages,
  };
  writeFileSync(
    join(output, ANGULAR_ARTIFACT_MANIFEST),
    `${JSON.stringify(artifactManifest, null, 2)}\n`,
  );
  return readAngularArtifactSet(output);
}

function parseArtifactManifest(path: string): AngularArtifactManifest {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("entryPackage" in value) ||
    value.entryPackage !== ANGULAR_ENTRY_PACKAGE ||
    !("packages" in value) ||
    typeof value.packages !== "object" ||
    value.packages === null ||
    Array.isArray(value.packages)
  ) {
    throw new Error(`${path} is not an Angular artifact manifest`);
  }
  return value as AngularArtifactManifest;
}

/** Read and validate a complete, directory-confined Angular artifact set. */
export function readAngularArtifactSet(directory: string): AngularArtifactSet {
  const root = resolve(directory);
  const manifest = parseArtifactManifest(join(root, ANGULAR_ARTIFACT_MANIFEST));
  const tarballs = new Map<string, string>();

  for (const [name, filename] of Object.entries(manifest.packages)) {
    if (
      !name.startsWith("@copilotkit/") ||
      typeof filename !== "string" ||
      basename(filename) !== filename ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(filename)
    ) {
      throw new Error(`${name} must reference a safe tarball filename`);
    }
    const tarball = join(root, filename);
    if (!existsSync(tarball) || !statSync(tarball).isFile()) {
      throw new Error(`${name} artifact is missing: ${tarball}`);
    }
    tarballs.set(name, tarball);
  }

  const entryTarball = tarballs.get(manifest.entryPackage);
  if (!entryTarball) {
    throw new Error(
      `${ANGULAR_ENTRY_PACKAGE} is missing from the Angular artifact set`,
    );
  }
  return { entryTarball, tarballs };
}
