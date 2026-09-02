import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const packageJson = readJson(new URL("./package.json", import.meta.url));
const nextPackageJson = readJson(require.resolve("next/package.json"));
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");

test("documents the pinned Next.js major and required Node.js version", () => {
  const pinnedNextVersion = packageJson.dependencies.next;
  const nextMajor = pinnedNextVersion.match(/^(\d+)\./)?.[1];
  const installedNextMajor = nextPackageJson.version.match(/^(\d+)\./)?.[1];
  const requiredNodeVersion =
    nextPackageJson.engines.node.match(/>=(\d+\.\d+\.\d+)/)?.[1];

  assert.ok(nextMajor, "expected an exact pinned Next.js version");
  assert.equal(installedNextMajor, nextMajor);
  assert.ok(
    requiredNodeVersion,
    "expected Next.js to declare a minimum Node version",
  );
  assert.match(readme, new RegExp(`Built%20with-Next\\.js%20${nextMajor}-`));
  assert.match(
    readme,
    new RegExp(`Node\\.js ${requiredNodeVersion.replaceAll(".", "\\.")}\\+`),
  );
});

test("documents pnpm as the required workspace package manager", () => {
  const workspaceDependencies = Object.entries(packageJson.dependencies).filter(
    ([, version]) => version.startsWith("workspace:"),
  );

  assert.ok(
    workspaceDependencies.length > 0,
    "expected the example to use workspace dependencies",
  );
  assert.match(readme, /^- pnpm$/m);
  assert.doesNotMatch(readme, /Using other package managers/);
  assert.doesNotMatch(readme, /^\s*(?:npm(?: run)?|yarn) (?:install|dev)\s*$/m);
});

test("does not document an unsupported openCopilot query parameter", () => {
  assert.doesNotMatch(readme, /openCopilot/);
});

test("passes the rendered tool result to SearchResults", () => {
  const rendererSnippet = readme.match(
    /```tsx\n(useRenderTool\(\{[\s\S]*?\n\}\);)\n```/,
  )?.[1];

  assert.ok(rendererSnippet, "expected a useRenderTool example");
  assert.match(
    rendererSnippet,
    /render: \(\{ parameters, status, result \}\) =>/,
  );
  assert.match(rendererSnippet, /<SearchResults[\s\S]*result=\{result\}/);
});
