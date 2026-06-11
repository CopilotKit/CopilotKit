// SHOWCASE_BACKEND_HOST_PATTERN contract tests for generate-registry.ts,
// run as a subprocess (the script executes main() at module load, so it
// cannot be imported). Two invariants:
//
// 1. A pattern without the `{slug}` placeholder must FAIL the build
//    loudly (stderr + non-zero exit — the contract vitest.global-setup
//    and CI consume), not silently bake the same backend host into
//    every integration.
// 2. Every `{slug}` occurrence is substituted (replaceAll parity with
//    the runtime consumer backendUrlFromPattern in
//    shell/src/lib/backend-url.ts), not just the first.

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { FileSnapshotRestorer, execOptsFor } from "./test-cleanup";
import { SCRIPTS_DIR, SHELL_DATA_DIR } from "./paths";

const SHOWCASE_ROOT = path.resolve(SCRIPTS_DIR, "..");
// Everything the generator writes — multi-emit registry/catalog plus the
// shell-only constraints.json — so a pattern-override run can't leave
// non-default artifacts behind for other suites or the dev server.
const DATA_FILES = [
  path.join(SHELL_DATA_DIR, "registry.json"),
  path.join(SHELL_DATA_DIR, "catalog.json"),
  path.join(SHELL_DATA_DIR, "constraints.json"),
  ...["shell-docs", "shell-dojo", "shell-dashboard"].flatMap((pkg) => [
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "registry.json"),
    path.join(SHOWCASE_ROOT, pkg, "src", "data", "catalog.json"),
  ]),
];
const dataRestorer = new FileSnapshotRestorer(DATA_FILES);
const EXEC_OPTS = execOptsFor(SCRIPTS_DIR);

function runGenerator(pattern: string): string {
  return execFileSync("npx", ["tsx", "generate-registry.ts"], {
    ...EXEC_OPTS,
    env: { ...process.env, SHOWCASE_BACKEND_HOST_PATTERN: pattern },
  }).toString();
}

beforeAll(() => {
  dataRestorer.snapshot();
});

afterEach(() => dataRestorer.restore());
afterAll(() => dataRestorer.restore());

describe("generate-registry SHOWCASE_BACKEND_HOST_PATTERN contract", () => {
  it("fails loudly (stderr + exit 1) when the pattern lacks the {slug} placeholder", () => {
    let thrown: unknown;
    try {
      runGenerator("no-placeholder.example.com");
    } catch (err) {
      thrown = err;
    }
    expect(
      thrown,
      "a {slug}-less pattern must fail the build, not bake one host everywhere",
    ).toBeInstanceOf(Error);
    const e = thrown as Error & { status?: number; stderr?: string };
    expect(e.status).toBe(1);
    expect(e.stderr).toContain("SHOWCASE_BACKEND_HOST_PATTERN");
    expect(e.stderr).toContain("{slug}");
  });

  it("substitutes EVERY {slug} occurrence into backend_url (replaceAll parity with backend-url.ts)", () => {
    runGenerator("{slug}.demos.example.com/{slug}");
    const registry = JSON.parse(
      fs.readFileSync(path.join(SHELL_DATA_DIR, "registry.json"), "utf-8"),
    ) as { integrations: Array<{ slug: string; backend_url: string }> };
    expect(registry.integrations.length).toBeGreaterThan(0);
    for (const { slug, backend_url } of registry.integrations) {
      expect(backend_url, `backend_url for "${slug}"`).toBe(
        `https://${slug}.demos.example.com/${slug}`,
      );
    }
  });
});
