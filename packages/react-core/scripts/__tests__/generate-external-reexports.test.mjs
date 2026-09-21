// Guards the fix for PE-41: `@copilotkit/react-core/v2` must stay importable
// from a React server component.
//
// The entry is a `"use client"` module. A bundler building the server/client
// boundary has to enumerate a client module's exports, and it cannot enumerate
// `export * from "<external package>"`, so Next.js rejects the module with
// "It's currently unsupported to use \"export *\" in a client boundary."
// That is why src/v2/external-reexports.ts lists the names of
// @copilotkit/core and @ag-ui/client one by one.
//
// A hand-maintained list of 400+ names silently goes stale the moment either
// package adds an export, so the list is generated and this test re-runs the
// generator against the installed packages and fails when the committed file no
// longer matches. The mutation test below covers the guard's FAILURE direction:
// a checker that cannot fail is not a guard.
//
// Standalone Node test (not vitest), matching the sibling script tests: the
// generator drives the TypeScript compiler and the package-wide vitest setup
// uses jsdom-only globals.
//
// Invoked from package.json `test:scripts` and the chained `test` command.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "../..");
const generator = path.join(pkgRoot, "scripts/generate-external-reexports.mjs");
const generated = path.join(pkgRoot, "src/v2/external-reexports.ts");
const entry = path.join(pkgRoot, "src/v2/index.ts");
const builtEntry = path.join(pkgRoot, "dist/v2/index.mjs");

const EXTERNAL_PACKAGES = ["@copilotkit/core", "@ag-ui/client"];

const runCheck = () =>
  spawnSync(process.execPath, [generator, "--check"], {
    cwd: pkgRoot,
    encoding: "utf8",
  });

describe("v2 external re-exports", () => {
  it("the committed list matches what the installed packages export", () => {
    const result = runCheck();
    assert.equal(
      result.status,
      0,
      `external-reexports.ts is stale.\n${result.stdout}${result.stderr}`,
    );
  });

  it("the check fails when the committed list drifts", () => {
    const original = fs.readFileSync(generated, "utf8");
    try {
      // Drop one name, the way a package adding an export would leave the
      // committed file short of the real surface.
      const shortened = original.replace(/^  CopilotKitCore,\n/m, "");
      assert.notEqual(shortened, original, "expected to remove a known name");
      fs.writeFileSync(generated, shortened);
      assert.equal(
        runCheck().status,
        1,
        "the --check gate passed on a list that had lost a name",
      );
    } finally {
      fs.writeFileSync(generated, original);
    }
    assert.equal(runCheck().status, 0, "failed to restore the committed list");
  });

  it("the entry does not star-re-export an external package", () => {
    const source = fs.readFileSync(entry, "utf8");
    for (const pkg of EXTERNAL_PACKAGES) {
      assert.doesNotMatch(
        source,
        new RegExp(`export\\s+\\*\\s+from\\s+["']${pkg}["']`),
        `src/v2/index.ts star-re-exports ${pkg}, which breaks the client boundary`,
      );
    }
  });

  it("lists names from both packages", () => {
    const source = fs.readFileSync(generated, "utf8");
    // One value and one type from each package, so a section that silently
    // emptied out is caught.
    assert.match(source, /^  CopilotKitCore,$/m);
    assert.match(source, /^  AbstractAgent,$/m);
    for (const pkg of EXTERNAL_PACKAGES) {
      assert.match(source, new RegExp(`from "${pkg}";`));
    }
  });

  it("the built entry carries no star re-export", (t) => {
    if (!fs.existsSync(builtEntry)) {
      t.skip("dist/v2/index.mjs is not built");
      return;
    }
    const built = fs.readFileSync(builtEntry, "utf8");
    assert.doesNotMatch(
      built,
      /^export\s+\*/m,
      "dist/v2/index.mjs star-re-exports a module Next.js cannot enumerate",
    );
  });
});
