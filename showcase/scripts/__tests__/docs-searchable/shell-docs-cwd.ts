// Import this before anything under lib/docs-searchable.
//
// The rules read shell-docs' content and its generated registry relative to
// the working directory (`src/content/docs`, `src/data/registry.json`), the
// way generate-search-index runs them: emit-searchable-pages.ts, with
// shell-docs as cwd. registry.ts and frontend-options.ts read the registry at
// module load, so the directory has to be right before they are imported.
// Each test file runs in its own process (vitest `pool: "forks"`), so the
// chdir stays in this file.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCRIPTS_DIR } from "../paths";
import { execOptsFor, withGeneratedDataLock } from "../test-cleanup";

export const SHELL_DOCS_ROOT = path.resolve(SCRIPTS_DIR, "..", "shell-docs");
export const SHELL_DOCS_DATA = path.join(SHELL_DOCS_ROOT, "src", "data");
export const REGISTRY_FILES = ["registry.json", "frontend-registry.json"];

const missing = () =>
  REGISTRY_FILES.some((f) => !fs.existsSync(path.join(SHELL_DOCS_DATA, f)));

// Gitignored output of generate-registry, which shell-docs' `showcase-data`
// and the shell image both run first. Generate it if this checkout hasn't.
if (missing()) {
  withGeneratedDataLock(() => {
    if (missing()) {
      execFileSync(
        "npx",
        ["tsx", "generate-registry.ts"],
        execOptsFor(SCRIPTS_DIR),
      );
    }
  });
}

process.chdir(SHELL_DOCS_ROOT);
