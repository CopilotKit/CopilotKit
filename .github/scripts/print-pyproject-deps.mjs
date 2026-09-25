#!/usr/bin/env node
/**
 * Prints one `[project].dependencies` entry per line for a pyproject.toml,
 * skipping members resolved from the working tree via `[tool.uv.sources]`.
 *
 * Used by .github/scripts/starter-clean-install.sh to install exactly what a
 * starter's agent declares, without building the project itself — a build
 * backend failure would otherwise be reported as a dependency failure.
 *
 * The parsers are shared with scripts/validate-starter-deps.mjs so the static
 * and dynamic halves of the PE-140 check read the manifests the same way.
 */

import * as fs from "node:fs";
import {
  parsePyprojectDeps,
  parseUvSources,
  splitRequirement,
} from "../../scripts/validate-starter-deps.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: print-pyproject-deps.mjs <pyproject.toml>");
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");
const local = parseUvSources(text);
for (const spec of parsePyprojectDeps(text)) {
  if (local.has(splitRequirement(spec).name)) continue;
  console.log(spec);
}
