// Bounds both collectors, including form values and request/response body capture and credential redaction (8 KiB gzip).
// Measures what an app ships: the published dist keeps comments, and app bundlers minify.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "tsdown";

const BUDGET_BYTES = 8 * 1024;
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "learning-size-"));

try {
  await build({
    config: false,
    cwd: root,
    entry: ["src/index.ts"],
    format: "esm",
    minify: true,
    dts: false,
    sourcemap: false,
    outDir,
    logLevel: "error",
  });
  const size = gzipSync(readFileSync(join(outDir, "index.mjs"))).length;
  console.log(
    `@copilotkit/learning minified: ${size} bytes gzip (budget ${BUDGET_BYTES})`,
  );
  if (size > BUDGET_BYTES) process.exitCode = 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
