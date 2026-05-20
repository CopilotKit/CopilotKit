// Shared path constants for showcase/scripts test suites. Centralized here
// so that repo-root / scripts-dir / data-dir drift in one place when the
// directory layout changes — several suites previously recomputed these and
// any future mismatch would be a silent bug.

import path from "path";

export const SCRIPTS_DIR = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(SCRIPTS_DIR, "..", "..");
export const SHELL_DATA_DIR = path.resolve(
  SCRIPTS_DIR,
  "..",
  "shell",
  "src",
  "data",
);
export const WORKFLOWS_DIR = path.resolve(REPO_ROOT, ".github", "workflows");
