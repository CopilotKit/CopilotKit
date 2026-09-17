import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { verifyArchive } from "./check.mjs";

/** Creates an isolated real npm-shaped archive for a license check. */
function setup(
  t,
  {
    license = "MIT",
    notice = "Approved license text",
    name = "@test/package",
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "package-license-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "package"));
  writeFileSync(
    join(root, "package/package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      ...(license === null ? {} : { license }),
    }),
  );
  if (notice !== null) writeFileSync(join(root, "package/LICENSE"), notice);
  const archive = join(root, "package.tgz");
  execFileSync("tar", ["-czf", archive, "-C", root, "package"]);
  return {
    archive,
    expected: {
      names: ["@test/package"],
      license: "MIT",
      notice: "Approved license text",
    },
  };
}

test("accepts the expected license and complete notice in the actual archive", (t) => {
  const { archive, expected } = setup(t);

  assert.doesNotThrow(() => verifyArchive(archive, expected));
});

test("rejects missing SPDX metadata even when the archive includes a license file", (t) => {
  const { archive, expected } = setup(t, { license: null });

  assert.throws(() => verifyArchive(archive, expected), /license.*MIT/);
});

test("rejects a different license even if it is a valid SPDX value", (t) => {
  const { archive, expected } = setup(t, { license: "Apache-2.0" });

  assert.throws(() => verifyArchive(archive, expected), /license.*MIT/);
});

test("rejects an omitted license file", (t) => {
  const { archive, expected } = setup(t, { notice: null });

  assert.throws(() => verifyArchive(archive, expected), /LICENSE/);
});

test("rejects a truncated or different notice", (t) => {
  const { archive, expected } = setup(t, { notice: "MIT" });

  assert.throws(() => verifyArchive(archive, expected), /notice/);
});

test("rejects a tarball for a different package", (t) => {
  const { archive, expected } = setup(t, { name: "@test/other" });

  assert.throws(() => verifyArchive(archive, expected), /name/);
});

test("accepts Apache packages without replacing their license with MIT", (t) => {
  const { archive, expected } = setup(t, { license: "Apache-2.0" });

  assert.doesNotThrow(() =>
    verifyArchive(archive, { ...expected, license: "Apache-2.0" }),
  );
});

test("accepts a proprietary package only with UNLICENSED and its complete notice", (t) => {
  const { archive, expected } = setup(t, { license: "UNLICENSED" });

  assert.doesNotThrow(() =>
    verifyArchive(archive, { ...expected, license: "UNLICENSED" }),
  );
});
