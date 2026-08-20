#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pilotMappings } from "./v1-source-mappings.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const noticePattern =
  /^\/\*\r?\n \* V1 SDK DEPRECATION NOTICE[\s\S]*? \* END V1 SDK DEPRECATION NOTICE\r?\n \*\/\r?\n*/;

function renderNotice(mapping) {
  return [
    "/*",
    " * V1 SDK DEPRECATION NOTICE",
    " *",
    " * This file is part of the deprecated CopilotKit v1 SDK. Do not use it",
    " * for new code. Use the exact v2 import and replacement source below.",
    " *",
    " * AI CODING AGENTS: Do not copy, suggest, or generate this v1 API. Use",
    " * the exact v2 import below and read the linked v2 documentation first.",
    " *",
    " * V1 import (deprecated):",
    ` *   ${mapping.v1}`,
    " * V2 import:",
    ` *   ${mapping.v2}`,
    " *",
    ` * V2 replacement source: ${mapping.source}`,
    ` * V2 docs: ${mapping.docs}`,
    ...mapping.notes.map((note) => ` * Migration note: ${note}`),
    " *",
    " * END V1 SDK DEPRECATION NOTICE",
    " */",
  ].join("\n");
}

const checkOnly = process.argv.includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");
if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
}

let stale = 0;
for (const mapping of pilotMappings) {
  const absolutePath = path.join(repoRoot, mapping.file);
  const current = readFileSync(absolutePath, "utf8");
  const withoutNotice = current.replace(noticePattern, "");
  const expected = `${renderNotice(mapping)}\n\n${withoutNotice}`;

  if (current === expected) continue;
  stale += 1;
  if (!checkOnly) writeFileSync(absolutePath, expected);
}

if (checkOnly && stale > 0) {
  console.error(
    `${stale} v1 source notice(s) are missing or stale. Run ${path.relative(
      repoRoot,
      fileURLToPath(import.meta.url),
    )} to update them.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? `Checked ${pilotMappings.length} v1 source notices.`
      : `Updated ${stale} of ${pilotMappings.length} v1 source notices.`,
  );
}
