import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/** Runs the copied setup script against isolated toolchain executables. */
function setup(version: unknown, pubExit = 0) {
  const root = mkdtempSync(join(tmpdir(), "flutter-preflight-"));
  const bin = join(root, "bin");
  const sdk = join(root, "flutter/.sdk");
  mkdirSync(bin);
  mkdirSync(sdk, { recursive: true });
  cpSync(new URL("../scripts", import.meta.url), join(root, "scripts"), {
    recursive: true,
  });
  const calls = join(root, "calls.jsonl");
  writeFileSync(calls, "");
  writeFileSync(join(sdk, "pubspec.yaml"), "keep until preflight passes");
  for (const command of ["git", "flutter"]) {
    writeFileSync(
      join(bin, command),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify([${JSON.stringify(command)}, ...args]) + '\\n');
if (${JSON.stringify(command)} === 'git') console.log('1f6006c270563fc305664bae30af975ba464d20b');
else if (args.includes('--machine')) console.log(${JSON.stringify(typeof version === "string" ? version : JSON.stringify(version))});
else process.exit(${pubExit});
`,
      { mode: 0o755 },
    );
  }
  return {
    root,
    sdk,
    run: () =>
      spawnSync(process.execPath, [join(root, "scripts/setup-flutter.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        },
        encoding: "utf8",
      }),
    calls: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    teardown: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Dart 3.12 stops before SDK edits with upgrade guidance and no stack trace", () => {
  const s = setup({ frameworkVersion: "3.44.0", dartSdkVersion: "3.12.0" });
  try {
    const result = s.run();

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Dart 3.12.0/);
    assert.match(result.stderr, /Flutter 3.47.0.*Dart 3.13.0/s);
    assert.match(result.stderr, /flutter upgrade/);
    assert.doesNotMatch(result.stderr, /at .*setup-flutter/);
    assert.equal(
      readFileSync(join(s.sdk, "pubspec.yaml"), "utf8"),
      "keep until preflight passes",
    );
    assert.deepEqual(s.calls(), [["flutter", "--version", "--machine"]]);
  } finally {
    s.teardown();
  }
});

for (const version of [
  { frameworkVersion: "3.46.9", dartSdkVersion: "3.13.0" },
  { frameworkVersion: "3.47.0", dartSdkVersion: "3.12.0" },
  { frameworkVersion: "3.47.0-0.1.pre", dartSdkVersion: "3.13.0" },
  { frameworkVersion: "3.47.0", dartSdkVersion: "3.13.0-1.0.dev" },
  { frameworkVersion: "4.0.0", dartSdkVersion: "3.13.0" },
  { frameworkVersion: "3.47.0", dartSdkVersion: "4.0.0" },
  {},
  null,
  "not JSON",
]) {
  test(`rejects unsupported or unreadable toolchain ${JSON.stringify(version)}`, () => {
    const s = setup(version);
    try {
      const result = s.run();

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Flutter 3.47.0/);
      assert.deepEqual(s.calls(), [["flutter", "--version", "--machine"]]);
      assert.equal(existsSync(join(s.sdk, "pubspec.yaml")), true);
    } finally {
      s.teardown();
    }
  });
}

for (const version of [
  { frameworkVersion: "3.47.0", dartSdkVersion: "3.13.0" },
  { frameworkVersion: "3.48.1", dartSdkVersion: "3.14.0 (stable)" },
]) {
  test(`prepares the SDK and gets packages with ${JSON.stringify(version)}`, () => {
    const s = setup(version);
    try {
      const result = s.run();

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Flutter app ready/);
      assert.equal(existsSync(join(s.sdk, "pubspec.yaml")), false);
      assert.deepEqual(s.calls(), [
        ["flutter", "--version", "--machine"],
        ["git", "rev-parse", "HEAD"],
        ["flutter", "pub", "get"],
      ]);
    } finally {
      s.teardown();
    }
  });
}

test("pub failure exits without a Node stack or false success", () => {
  const s = setup({ frameworkVersion: "3.47.0", dartSdkVersion: "3.13.0" }, 1);
  try {
    const result = s.run();

    assert.equal(result.status, 1);
    assert.match(result.stderr, /flutter pub get/);
    assert.doesNotMatch(result.stderr, /at .*setup-flutter/);
    assert.doesNotMatch(result.stdout, /Flutter app ready/);
  } finally {
    s.teardown();
  }
});
