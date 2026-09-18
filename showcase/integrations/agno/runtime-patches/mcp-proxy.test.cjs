const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const manifest = require("./manifest.json");
const source =
  process.env.RUNTIME_PATCH_TEST_SOURCE ||
  path.resolve("node_modules/@copilotkit/runtime");
const installer = path.join(__dirname, "apply.cjs");

function withRuntime(run) {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".runtime-patch-test-"));
  try {
    for (const file of [
      "package.json",
      ...manifest.modules.map((entry) => entry.path),
    ]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(source, file), target);
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function apply(root) {
  return spawnSync(process.execPath, [installer, root], { encoding: "utf8" });
}

test("patches the actual locked modules and is exactly idempotent", () =>
  withRuntime((root) => {
    const before = manifest.modules.map((entry) =>
      fs.readFileSync(path.join(root, entry.path), "utf8"),
    );
    assert.equal(apply(root).status, 0);
    const after = manifest.modules.map((entry) =>
      fs.readFileSync(path.join(root, entry.path), "utf8"),
    );
    for (let i = 0; i < manifest.modules.length; i++) {
      const entry = manifest.modules[i];
      assert.equal(
        after[i],
        entry.import +
          before[i].replace(entry.anchor, entry.anchor + entry.branch),
      );
    }
    assert.equal(apply(root).status, 0);
    assert.deepEqual(
      manifest.modules.map((entry) =>
        fs.readFileSync(path.join(root, entry.path), "utf8"),
      ),
      after,
    );
  }));

test("rejects wrong versions before touching handler modules", () =>
  withRuntime((root) => {
    const before = manifest.modules.map((entry) =>
      fs.readFileSync(path.join(root, entry.path)),
    );
    const packagePath = path.join(root, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath));
    pkg.version = "0.0.0";
    fs.writeFileSync(packagePath, JSON.stringify(pkg));
    assert.notEqual(apply(root).status, 0);
    assert.deepEqual(
      manifest.modules.map((entry) =>
        fs.readFileSync(path.join(root, entry.path)),
      ),
      before,
    );
    assert.equal(fs.existsSync(path.join(root, manifest.helperPath)), false);
  }));

test("rejects drift in the second module without partially patching the first", () =>
  withRuntime((root) => {
    const first = path.join(root, manifest.modules[0].path);
    const before = fs.readFileSync(first);
    fs.appendFileSync(
      path.join(root, manifest.modules[1].path),
      "\n// unexpected drift\n",
    );
    assert.notEqual(apply(root).status, 0);
    assert.deepEqual(fs.readFileSync(first), before);
    assert.equal(fs.existsSync(path.join(root, manifest.helperPath)), false);
  }));

test("rejects a tampered helper on an already patched installation", () =>
  withRuntime((root) => {
    assert.equal(apply(root).status, 0);
    fs.appendFileSync(
      path.join(root, manifest.helperPath),
      "\n// unexpected drift\n",
    );
    assert.notEqual(apply(root).status, 0);
  }));
