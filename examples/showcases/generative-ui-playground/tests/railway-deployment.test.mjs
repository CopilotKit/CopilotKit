import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../..");
const demoDirectory = resolve(
  repositoryRoot,
  "examples/showcases/generative-ui-playground",
);

test("the frontend Railway image builds from the CopilotKit workspace", async () => {
  const dockerfile = await readFile(
    resolve(demoDirectory, "Dockerfile"),
    "utf8",
  );
  const railwayConfig = await readFile(
    resolve(demoDirectory, "railway.toml"),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(resolve(demoDirectory, "package.json"), "utf8"),
  );

  const workspaceDependencies = Object.entries(packageJson.dependencies)
    .filter(([, version]) => version === "workspace:*")
    .map(([name]) => name);

  assert.ok(
    workspaceDependencies.length > 0,
    "fixture must contain workspace dependencies",
  );
  assert.match(
    dockerfile,
    /COPY package\.json pnpm-workspace\.yaml pnpm-lock\.yaml \.pnpmfile\.cjs \.npmrc \.\//,
    "the Docker build context must be the monorepo root",
  );
  assert.match(
    dockerfile,
    /COPY packages \.\/packages/,
    "workspace package sources must be available to pnpm",
  );
  assert.match(
    dockerfile,
    /pnpm install --frozen-lockfile --ignore-scripts --filter ui-protocols-demo\.\.\./,
  );
  assert.match(dockerfile, /pnpm --filter ui-protocols-demo\.\.\. build/);
  assert.doesNotMatch(
    dockerfile,
    /^RUN npm install/m,
    "npm cannot resolve the demo's workspace:* dependencies in isolation",
  );
  assert.match(
    railwayConfig,
    /dockerfilePath = "examples\/showcases\/generative-ui-playground\/Dockerfile"/,
  );
  assert.match(railwayConfig, /healthcheckPath = "\/"/);
});

test("the sidecars declare their stable health endpoints", async () => {
  const [a2aConfig, mcpConfig] = await Promise.all([
    readFile(resolve(demoDirectory, "a2a-agent/railway.toml"), "utf8"),
    readFile(resolve(demoDirectory, "mcp-server/railway.toml"), "utf8"),
  ]);

  assert.match(a2aConfig, /healthcheckPath = "\/\.well-known\/agent\.json"/);
  assert.match(mcpConfig, /healthcheckPath = "\/health"/);
});
