import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasChanges } from "./github";
test("hasChanges reflects working tree", () => {
  const d = mkdtempSync(join(tmpdir(), "ht-"));
  execFileSync("git", ["init", "-q"], { cwd: d });
  expect(hasChanges(d)).toBe(false);
  writeFileSync(join(d, "a.txt"), "x");
  expect(hasChanges(d)).toBe(true);
});
