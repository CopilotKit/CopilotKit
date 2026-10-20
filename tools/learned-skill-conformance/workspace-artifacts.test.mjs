import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as helper from "./workspace-artifacts.mjs";

function workspace(t, packages) {
  const root = mkdtempSync(join(tmpdir(), "workspace-artifacts-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [directory, manifest] of Object.entries(packages)) {
    const folder = join(root, "packages", directory);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "package.json"),
      JSON.stringify({ version: "1.0.0", ...manifest }),
    );
  }
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  return { root, artifacts };
}

test("packs shared and cyclic public dependencies once with local npm overrides", (t) => {
  assert.equal(
    typeof helper.packRuntimeWorkspace,
    "function",
    "Workspace artifact packer is required",
  );
  const { root, artifacts } = workspace(t, {
    runtime: {
      name: "@copilotkit/runtime",
      dependencies: {
        "@fixture/left": "1.0.0",
        "@fixture/right": "1.0.0",
        external: "1.0.0",
      },
      devDependencies: { "@fixture/private": "1.0.0" },
    },
    left: {
      name: "@fixture/left",
      dependencies: { "@fixture/shared": "1.0.0" },
    },
    right: {
      name: "@fixture/right",
      optionalDependencies: { "@fixture/shared": "1.0.0" },
    },
    shared: {
      name: "@fixture/shared",
      dependencies: { "@fixture/left": "1.0.0" },
    },
    private: { name: "@fixture/private", private: true },
  });
  const result = helper.packRuntimeWorkspace(root, artifacts);
  assert.deepEqual(Object.keys(result.dependencies).sort(), [
    "@copilotkit/runtime",
    "@fixture/left",
    "@fixture/right",
    "@fixture/shared",
  ]);
  assert.equal(readdirSync(artifacts).length, 4);
  for (const [name, specifier] of Object.entries(result.dependencies)) {
    assert(specifier.startsWith("file:"));
    assert(existsSync(specifier.slice(5)));
    assert.equal(result.overrides[name], `$${name}`);
  }
});

test("rejects private runtime dependencies before packing any artifacts", (t) => {
  assert.equal(
    typeof helper.packRuntimeWorkspace,
    "function",
    "Workspace artifact packer is required",
  );
  const { root, artifacts } = workspace(t, {
    runtime: {
      name: "@copilotkit/runtime",
      dependencies: { "@fixture/private": "1.0.0" },
    },
    private: { name: "@fixture/private", private: true },
  });
  assert.throws(
    () => helper.packRuntimeWorkspace(root, artifacts),
    /private.*@fixture\/private/i,
  );
  assert.deepEqual(readdirSync(artifacts), []);
});

test("standalone child processes cannot resolve packages through inherited NODE_PATH", (t) => {
  assert.equal(
    typeof helper.standaloneConsumerEnv,
    "function",
    "Standalone environment isolation is required",
  );
  const { root } = workspace(t, {});
  const leakedModules = join(root, "leaked-node-modules");
  const leakedPackage = join(leakedModules, "workspace-only-package");
  mkdirSync(leakedPackage, { recursive: true });
  writeFileSync(join(leakedPackage, "index.js"), "module.exports = true;");
  const inherited = {
    ...process.env,
    NODE_PATH: leakedModules,
    NODE_OPTIONS: "--no-warnings",
  };
  const resolvePackage =
    "console.log(require.resolve('workspace-only-package'))";
  assert.match(
    execFileSync(process.execPath, ["-e", resolvePackage], {
      cwd: root,
      env: inherited,
      encoding: "utf8",
    }),
    /leaked-node-modules/,
  );
  const isolated = helper.standaloneConsumerEnv(inherited);
  assert.equal(isolated.NODE_OPTIONS, inherited.NODE_OPTIONS);
  assert.equal(inherited.NODE_PATH, leakedModules);
  execFileSync(
    process.execPath,
    [
      "-e",
      "require('node:assert/strict').throws(() => require.resolve('workspace-only-package'), e => e.code === 'MODULE_NOT_FOUND')",
    ],
    { cwd: root, env: isolated },
  );
});
