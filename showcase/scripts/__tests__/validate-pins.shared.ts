// Shared helpers for validate-pins.*.test.ts files.
//
// These tests were originally a single multi-thousand-line file. They
// were split per describe-category to keep each file comfortably under
// vitest's hardcoded 60s birpc `onTaskUpdate` RPC window (upstream
// vitest #6129 — `DEFAULT_TIMEOUT = 6e4` in the bundled birpc). With
// `pool: 'forks'` (see showcase/scripts/vitest.config.ts) each file
// gets its own fresh worker + its own fresh 60s RPC budget.
//
// This module hosts the tmpdir / write / withTmp helpers and the
// FIXTURES_DIR / VALIDATE_PINS_SCRIPT path constants so we don't
// duplicate them across split files.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "pins");
export const VALIDATE_PINS_SCRIPT = path.resolve(
  __dirname,
  "..",
  "validate-pins.ts",
);

export function tmpdir(prefix = "validate-pins-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
}

/**
 * Safe-cleanup helper: call body() but always rm -rf tmp in finally so
 * an assertion failure doesn't leak temp directories into /tmp.
 */
export function withTmp<T>(body: (tmp: string) => T): T {
  const tmp = tmpdir();
  try {
    return body(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
