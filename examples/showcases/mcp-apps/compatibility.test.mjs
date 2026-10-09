import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dockerfileSource = readFileSync(
  path.join(projectRoot, "Dockerfile"),
  "utf8",
);
const packageJson = readJson("package.json");
const routeSource = readFileSync(
  path.join(projectRoot, "src/app/api/copilotkit/[[...slug]]/route.ts"),
  "utf8",
);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

test("imports the runtime endpoint stack from the v2 entrypoint", () => {
  const runtimeImport = routeSource.match(
    /import\s*\{([^}]*)\}\s*from\s*["']@copilotkit\/runtime\/v2["']/s,
  );
  assert.ok(runtimeImport, "the v2 runtime import must exist");

  for (const runtimeExport of [
    "BuiltInAgent",
    "CopilotRuntime",
    "createCopilotEndpoint",
    "InMemoryAgentRunner",
  ]) {
    assert.match(runtimeImport[1], new RegExp(`\\b${runtimeExport}\\b`));
  }

  assert.doesNotMatch(routeSource, /from\s*["']@copilotkit\/runtime["']/);
});

test("uses the authoritative single-version AG-UI graph", () => {
  assert.equal(packageJson.dependencies["@ag-ui/client"], "0.0.58");
  assert.equal(
    packageJson.dependencies["@ag-ui/mcp-apps-middleware"],
    "^0.0.3",
  );
  assert.equal(packageJson.dependencies["@ag-ui/encoder"], undefined);
  assert.deepEqual(packageJson.overrides, {
    "@ag-ui/client": "0.0.58",
    "@ag-ui/core": "0.0.58",
    "@ag-ui/encoder": "0.0.58",
    "@ag-ui/proto": "0.0.58",
  });
});

test("records the npm dependency graph used by the Docker build", () => {
  const lockfilePath = path.join(projectRoot, "package-lock.json");
  assert.equal(existsSync(lockfilePath), true, "package-lock.json must exist");

  const packageLock = readJson("package-lock.json");
  assert.deepEqual(
    packageLock.packages[""].dependencies,
    packageJson.dependencies,
  );

  for (const packageName of ["client", "core", "encoder", "proto"]) {
    const packageSuffix = `node_modules/@ag-ui/${packageName}`;
    const versions = Object.entries(packageLock.packages)
      .filter(([packagePath]) => packagePath.endsWith(packageSuffix))
      .map(([, packageMetadata]) => packageMetadata.version);

    assert.deepEqual(
      [...new Set(versions)],
      ["0.0.58"],
      `@ag-ui/${packageName} must resolve only to 0.0.58`,
    );
  }
});

test("installs the locked npm graph in Docker", () => {
  assert.match(dockerfileSource, /^RUN npm ci --legacy-peer-deps$/m);
  assert.doesNotMatch(dockerfileSource, /^RUN npm install\b/m);
});

test("does not copy host install artifacts into Docker", () => {
  const dockerignorePath = path.join(projectRoot, ".dockerignore");
  assert.equal(existsSync(dockerignorePath), true, ".dockerignore must exist");
  const dockerignoreEntries = readFileSync(dockerignorePath, "utf8")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  assert.ok(dockerignoreEntries.includes("node_modules"));
  assert.ok(dockerignoreEntries.includes(".next"));
});
