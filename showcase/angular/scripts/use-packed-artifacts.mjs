import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function yamlSingleQuoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function artifactReferences(artifactDirectory) {
  const root = resolve(artifactDirectory);
  const manifestPath = join(root, "artifacts.json");
  const manifest = readJson(manifestPath);
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.entryPackage !== "@copilotkit/angular" ||
    typeof manifest?.packages !== "object" ||
    manifest.packages === null ||
    Array.isArray(manifest.packages)
  ) {
    throw new Error(`${manifestPath} is not an Angular artifact manifest`);
  }

  const references = {};
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
    if (!existsSync(tarball)) {
      throw new Error(`${name} artifact is missing: ${tarball}`);
    }
    references[name] = `file:${tarball}`;
  }
  return references;
}

/** Make the Showcase host consume only the supplied packed CopilotKit graph. */
export function usePackedArtifacts({ hostDirectory, artifactDirectory }) {
  const host = resolve(hostDirectory);
  const packagePath = join(host, "package.json");
  const tsconfigPath = join(host, "tsconfig.json");
  const packageManifest = readJson(packagePath);
  const references = artifactReferences(artifactDirectory);

  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const dependencies = packageManifest[field];
    if (typeof dependencies !== "object" || dependencies === null) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) {
        continue;
      }
      const reference = references[name];
      if (!reference) {
        throw new Error(`${name} has no packed artifact`);
      }
      dependencies[name] = reference;
    }
  }

  writeFileSync(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  writeFileSync(
    join(host, "pnpm-workspace.yaml"),
    [
      'packages: ["."]',
      "overrides:",
      ...Object.entries(references).map(
        ([name, reference]) =>
          `  ${yamlSingleQuoted(name)}: ${yamlSingleQuoted(reference)}`,
      ),
      "",
    ].join("\n"),
  );

  const tsconfig = readJson(tsconfigPath);
  const paths = tsconfig?.compilerOptions?.paths;
  if (typeof paths === "object" && paths !== null) {
    for (const name of Object.keys(references)) {
      delete paths[name];
      delete paths[`${name}/*`];
    }
  }
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  const artifactDirectory = process.argv[2];
  if (!artifactDirectory) {
    throw new Error(
      "usage: node scripts/use-packed-artifacts.mjs <artifact-directory>",
    );
  }
  usePackedArtifacts({ hostDirectory: process.cwd(), artifactDirectory });
}
