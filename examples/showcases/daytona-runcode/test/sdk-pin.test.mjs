// Keeps the Daytona demo, its lockfile, the cookbook recipe, and the docs
// doctest on one verified `@daytonaio/sdk` version.
//
// Offline only: nothing here creates a Daytona client or a sandbox. The
// installed-SDK checks load the real package in a scrubbed subprocess with
// sockets, DNS, and fetch blocked, and type-check the app with `tsc`.
// Run `npm ci` first; without node_modules those checks are skipped.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SDK = "@daytonaio/sdk";
const exampleDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(exampleDir, "..", "..", "..");
const contentDir = join(repoRoot, "showcase", "shell-docs", "src", "content");
const recipePath = join(contentDir, "docs", "cookbook", "daytona.mdx");
const doctestPath = join(contentDir, "doctest.json");
const routePath = join(
  exampleDir,
  "app",
  "api",
  "copilotkit-single",
  "route.ts",
);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const pkg = readJson(join(exampleDir, "package.json"));
const lock = readJson(join(exampleDir, "package-lock.json"));
const pin = pkg.dependencies[SDK];
const installedSdkDir = join(exampleDir, "node_modules", SDK);
const installed = existsSync(join(installedSdkDir, "package.json"));
const needsInstall = installed ? false : "run `npm ci` first";

test("demo pins an exact legacy 0.x SDK version", () => {
  assert.match(pin, /^0\.\d+\.\d+$/, `${SDK} must be an exact 0.x pin`);
});

test("lockfile resolves exactly the pinned SDK", () => {
  assert.equal(lock.packages[""].dependencies[SDK], pin);
  const entry = lock.packages[`node_modules/${SDK}`];
  assert.equal(entry.version, pin);
  assert.equal(
    entry.resolved,
    `https://registry.npmjs.org/${SDK}/-/sdk-${pin}.tgz`,
  );
  // The SDK pins its generated API clients exactly; the lock must match.
  for (const [name, spec] of Object.entries(entry.dependencies)) {
    if (!name.startsWith("@daytona/")) continue;
    assert.equal(lock.packages[`node_modules/${name}`]?.version, spec, name);
  }
});

test("docs doctest uses the same SDK pin", () => {
  const deps = readJson(doctestPath).typescript.deps.filter((d) =>
    d.startsWith(`${SDK}`),
  );
  assert.deepEqual(deps, [`${SDK}@${pin}`]);
});

test("every recipe install command uses the same SDK pin", () => {
  const recipe = readFileSync(recipePath, "utf8");
  const installs = recipe.match(/npm install @daytonaio\/sdk\S*/g) ?? [];
  assert.ok(installs.length >= 2, "expected the install step and the prompt");
  for (const cmd of installs) {
    assert.equal(cmd.replace(/[`.]+$/, ""), `npm install ${SDK}@${pin}`);
  }
});

test("demo route and recipe use the same SDK calls", () => {
  const recipe = readFileSync(recipePath, "utf8");
  const route = readFileSync(routePath, "utf8");
  for (const call of [
    `import { Daytona } from "${SDK}";`,
    "new Daytona()",
    "await daytona.create({ language })",
    "await sandbox.process.codeRun(code)",
    "return { stdout: res.result, exitCode: res.exitCode };",
    "await sandbox.delete()",
  ]) {
    assert.ok(route.includes(call), `route.ts is missing: ${call}`);
    assert.ok(recipe.includes(call), `daytona.mdx is missing: ${call}`);
  }
});

test("installed SDK is the pinned version", { skip: needsInstall }, () => {
  assert.equal(readJson(join(installedSdkDir, "package.json")).version, pin);
});

test(
  "real SDK exports the recipe's runtime surface (network blocked)",
  { skip: needsInstall },
  () => {
    const entry = createRequire(join(exampleDir, "package.json")).resolve(SDK);
    const probe = `
      const sdk = require(process.argv[1]);
      const has = (cls, m) => typeof cls?.prototype?.[m] === "function";
      console.log(JSON.stringify({
        Daytona: typeof sdk.Daytona,
        create: has(sdk.Daytona, "create"),
        delete: has(sdk.Sandbox, "delete"),
        stop: has(sdk.Sandbox, "stop"),
        getPreviewLink: has(sdk.Sandbox, "getPreviewLink"),
        codeRun: has(sdk.Process, "codeRun"),
        executeCommand: has(sdk.Process, "executeCommand"),
      }));
    `;
    const cwd = mkdtempSync(join(tmpdir(), "daytona-sdk-probe-"));
    try {
      const out = execFileSync(
        process.execPath,
        [
          "-r",
          join(exampleDir, "test", "block-network.cjs"),
          "-e",
          probe,
          entry,
        ],
        // Scrubbed: no DAYTONA_* keys, no tokens, no project .env in cwd.
        { cwd, env: { PATH: process.env.PATH, HOME: cwd }, encoding: "utf8" },
      );
      assert.deepEqual(JSON.parse(out.trim().split("\n").pop()), {
        Daytona: "function",
        create: true,
        delete: true,
        stop: true,
        getPreviewLink: true,
        codeRun: true,
        executeCommand: true,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

test(
  "app and recipe contract type-check against installed SDK types",
  { skip: needsInstall },
  () => {
    const tsc = join(exampleDir, "node_modules", "typescript", "bin", "tsc");
    // Covers app/**, including the demo route, and test/sdk-contract.ts.
    execFileSync(
      process.execPath,
      [tsc, "--noEmit", "--incremental", "false", "-p", "tsconfig.json"],
      {
        cwd: exampleDir,
        env: { PATH: process.env.PATH, HOME: tmpdir() },
        stdio: "pipe",
      },
    );
  },
);
