import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDependencyInstaller } from "./dependencies.mjs";

function fixture(t, runtimeAgentDependencies = {}) {
  const root = mkdtempSync(join(tmpdir(), "doctest-deps-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime.tgz");
  const shared = join(root, "shared.tgz");
  writeFileSync(runtime, "runtime build one");
  writeFileSync(shared, "shared build one");
  const packed = {
    dependencies: {
      "@copilotkit/runtime": `file:${runtime}`,
      "@copilotkit/shared": `file:${shared}`,
    },
    overrides: {
      "@copilotkit/runtime": "$@copilotkit/runtime",
      "@copilotkit/shared": "$@copilotkit/shared",
    },
  };
  const calls = [];
  let packs = 0;
  const install = createDependencyInstaller({
    outputDir: root,
    runtimeAgentDependencies,
    packRuntime: () => {
      packs++;
      return packed;
    },
    install: (command, args, options) => {
      calls.push({ command, args, options });
      mkdirSync(join(options.cwd, "node_modules"), { recursive: true });
    },
  });
  const snippet = (name) => {
    const dir = join(root, name);
    mkdirSync(dir);
    return dir;
  };
  return {
    root,
    runtime,
    shared,
    packed,
    calls,
    install,
    snippet,
    packs: () => packs,
  };
}

test("installs current packed runtime graph with npm overrides and retains external dependencies", (t) => {
  const f = fixture(t);
  f.install(f.snippet("one"), [
    "@copilotkit/runtime@1.68.3",
    "next@15",
    "@ag-ui/core@0.0.57",
  ]);
  const call = f.calls[0];
  const manifest = JSON.parse(
    readFileSync(join(call.options.cwd, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.dependencies, {
    "@copilotkit/runtime": f.packed.dependencies["@copilotkit/runtime"],
    next: "15",
    "@ag-ui/core": "0.0.57",
    "@copilotkit/shared": f.packed.dependencies["@copilotkit/shared"],
  });
  assert.deepEqual(manifest.overrides, f.packed.overrides);
  assert.equal(call.command, "npm");
  assert.deepEqual(call.args, ["install", "--no-audit", "--no-fund"]);
});

test("shares completed installs regardless of dependency order", (t) => {
  const f = fixture(t);
  const one = f.snippet("one"),
    two = f.snippet("two");
  f.install(one, ["@copilotkit/runtime@1.68.3", "typescript"]);
  f.install(two, ["typescript", "@copilotkit/runtime@1.68.3"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.packs(), 1);
  assert.equal(
    realpathSync(join(one, "node_modules")),
    realpathSync(join(two, "node_modules")),
  );
});

test("invalidates the store when packed bytes change at the same path", (t) => {
  const f = fixture(t);
  f.install(f.snippet("one"), ["@copilotkit/runtime@1.68.3"]);
  writeFileSync(f.shared, "shared build two");
  f.install(f.snippet("two"), ["@copilotkit/runtime@1.68.3"]);
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].options.cwd, f.calls[1].options.cwd);
});

test("updates an existing snippet link to the rebuilt artifact store", (t) => {
  const f = fixture(t);
  const snippet = f.snippet("one");
  f.install(snippet, ["@copilotkit/runtime@1.68.3"]);
  const previous = realpathSync(join(snippet, "node_modules"));
  writeFileSync(f.runtime, "runtime build two");
  f.install(snippet, ["@copilotkit/runtime@1.68.3"]);
  assert.notEqual(realpathSync(join(snippet, "node_modules")), previous);
});

test("validates original names before packing and leaves non-runtime snippets alone", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.install(f.snippet("bad"), [
        "@copilotkit/runtime@1.68.3",
        "file:/untrusted.tgz",
      ]),
    /Invalid dependency name/,
  );
  assert.equal(f.packs(), 0);
  f.install(f.snippet("plain"), ["typescript"]);
  assert.equal(f.packs(), 0);
  const manifest = JSON.parse(
    readFileSync(join(f.calls[0].options.cwd, "package.json"), "utf8"),
  );
  assert.deepEqual(manifest.dependencies, { typescript: "*" });
  assert.deepEqual(manifest.overrides, {});
});

test("retries an incomplete npm install even when node_modules exists", (t) => {
  const f = fixture(t);
  let attempts = 0;
  const install = createDependencyInstaller({
    outputDir: f.root,
    packRuntime: () => f.packed,
    install: (command, args, { cwd }) => {
      mkdirSync(join(cwd, "node_modules"), { recursive: true });
      if (++attempts === 1) throw new Error("ETARGET");
    },
  });
  const snippet = f.snippet("retry");
  assert.throws(() => install(snippet, ["typescript"]), /ETARGET/);
  install(snippet, ["typescript"]);
  assert.equal(attempts, 2);
});

test("does not let Nx NODE_PATH leak checkout modules into npm consumers", (t) => {
  const previous = process.env.NODE_PATH;
  process.env.NODE_PATH = "/checkout/node_modules";
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previous;
  });
  const f = fixture(t);
  f.install(f.snippet("isolated"), ["typescript"]);
  assert.ok(f.calls[0].options.env);
  assert.equal(f.calls[0].options.env.NODE_PATH, undefined);
  assert.equal(f.calls[0].options.env.PATH, process.env.PATH);
});

test("aligns only shared AG-UI agent types with the checkout Runtime", (t) => {
  const f = fixture(t, {
    "@ag-ui/client": "0.0.59",
    "@ag-ui/core": "0.0.59",
    "@ag-ui/mastra": "9.0.0",
  });
  f.install(f.snippet("agent"), [
    "@copilotkit/runtime@1.68.3",
    "@ag-ui/client@0.0.57",
    "@ag-ui/core@0.0.57",
    "@ag-ui/mastra@1.1.2",
    "next@15",
  ]);
  const manifest = JSON.parse(
    readFileSync(join(f.calls[0].options.cwd, "package.json"), "utf8"),
  );
  assert.equal(manifest.dependencies["@ag-ui/client"], "0.0.59");
  assert.equal(manifest.dependencies["@ag-ui/core"], "0.0.59");
  assert.equal(manifest.dependencies["@ag-ui/mastra"], "1.1.2");
  assert.equal(manifest.dependencies.next, "15");
  assert.equal(manifest.overrides["@ag-ui/client"], "$@ag-ui/client");
  assert.equal(manifest.overrides["@ag-ui/core"], "$@ag-ui/core");
  assert.equal(manifest.overrides["@ag-ui/mastra"], undefined);
});
