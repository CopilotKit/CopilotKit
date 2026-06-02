// Copies non-TypeScript runtime assets from src/ into dist/ after `tsc`.
//
// `tsc` only emits .js for .ts inputs — it does NOT copy sibling data files
// (.json / .yml / .yaml). Several modules read a sibling asset at module-load
// via an `import.meta.url`-relative path (e.g. probes/helpers/spec-cell-mapping.ts
// reads spec-cell-mapping.json, probes/helpers/skip-list.ts reads skip-list.json).
// Without this step those files are absent from dist/, so the compiled module
// throws ENOENT on import and the orchestrator crash-loops on boot.
//
// Mirror every non-.ts file under src/ into dist/, preserving the relative
// layout (rootDir=src → outDir=dist is 1:1), so any future sibling asset is
// covered automatically with no per-file maintenance.
import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");
const distDir = path.resolve(here, "../dist");

const SKIP_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

cpSync(srcDir, distDir, {
  recursive: true,
  // Copy directories (so we can recurse into them) and any non-source file.
  // Test files never reach dist because tsconfig.build.json excludes them
  // from compilation; we mirror only data assets, not *.ts, so .test.ts and
  // their fixtures under src/ are skipped by the extension filter below.
  filter: (source) => {
    const ext = path.extname(source);
    // Always descend into directories.
    if (ext === "") return true;
    // Skip TypeScript sources — tsc already emitted their .js.
    if (SKIP_EXT.has(ext)) return false;
    // Everything else (.json, .yml, .yaml, ...) is a runtime asset.
    return true;
  },
});
