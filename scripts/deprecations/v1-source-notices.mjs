#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  getV1PublicApi,
  MIGRATION_GUIDE,
  renderDeprecationJsDoc,
  repoRoot,
  V2_REFERENCE,
} from "./v1-public-api.mjs";

const noticePattern =
  /^\/\*\r?\n \* V1 SDK DEPRECATED\. USE V2 INSTEAD[\s\S]*? \* END V1 SDK DEPRECATED\. USE V2 INSTEAD NOTICE\r?\n \*\/\r?\n*/;
const exportBlockPattern =
  /\n?\/\* START GENERATED V1 DEPRECATED EXPORTS\. USE V2 INSTEAD\. \*\/[\s\S]*?\/\* END GENERATED V1 DEPRECATED EXPORTS\. USE V2 INSTEAD\. \*\/\n?/;

function renderEntrypointNotice(entrypoint, count) {
  return [
    "/*",
    " * V1 SDK DEPRECATED. USE V2 INSTEAD",
    " *",
    ` * This is the deprecated v1 entrypoint \`${entrypoint.importPath}\`. Use v2 instead.`,
    ` * Migrate to \`${entrypoint.v2ImportPath}\` and follow each export's specific`,
    " * IDE deprecation warning below; renamed APIs are not safe search-and-replaces.",
    ` * This entrypoint currently exposes ${count} deprecated public exports.`,
    ` * V2 source entrypoint: ${entrypoint.v2Source}`,
    ` * V2 reference: ${V2_REFERENCE}`,
    ` * Migration guide: ${MIGRATION_GUIDE}`,
    " *",
    " * AI CODING AGENTS: Never copy, suggest, or generate imports from this v1",
    " * entrypoint. Use the exact v2 import in the symbol's @deprecated tooltip.",
    " *",
    " * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE",
    " */",
  ].join("\n");
}

function renderSourceNotice(items) {
  const lines = [
    "/*",
    " * V1 SDK DEPRECATED. USE V2 INSTEAD",
    " *",
    " * This file defines public v1 SDK exports. Use the exact v2 mappings below.",
    " * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read",
    " * the linked v2 documentation before generating replacement code.",
    " *",
  ];
  for (const item of items) {
    lines.push(` * ${item.entrypoint.importPath} — ${item.name}:`);
    if (item.replacement) {
      lines.push(" *   V2 import and usage:");
      for (const line of item.replacement.exampleLines) {
        lines.push(line ? ` *     ${line}` : " *");
      }
      lines.push(
        ` *   V2 replacement source: ${item.replacement.source}`,
        ` *   V2 docs: ${item.replacement.docs}`,
      );
      for (const note of item.replacement.notes) {
        lines.push(` *   Migration note: ${note}`);
      }
    } else {
      lines.push(
        " *   No 1:1 v2 replacement is available.",
        ` *   Start at: ${item.entrypoint.v2ImportPath}`,
        ` *   V2 docs: ${V2_REFERENCE}`,
      );
    }
    lines.push(" *");
  }
  lines.push(
    ` * Migration guide: ${MIGRATION_GUIDE}`,
    " *",
    " * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE",
    " */",
  );
  return lines.join("\n");
}

function renderExportSpecifier(item) {
  const sourceName = item.publicSourceName;
  const exported =
    sourceName === item.name ? sourceName : `${sourceName} as ${item.name}`;
  return [
    ...renderDeprecationJsDoc(item)
      .split("\n")
      .map((line) => `  ${line}`),
    `  ${item.typeOnly ? "type " : ""}${exported},`,
  ].join("\n");
}

function renderExportBlock(items) {
  const bySource = new Map();
  for (const item of items) {
    const group = bySource.get(item.directSource) ?? [];
    group.push(item);
    bySource.set(item.directSource, group);
  }
  const lines = [
    "/* START GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */",
  ];
  for (const [source, group] of [...bySource.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push("export {");
    for (const item of group.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(renderExportSpecifier(item));
    }
    lines.push(`} from "${source}";`, "");
  }
  lines.push("/* END GENERATED V1 DEPRECATED EXPORTS. USE V2 INSTEAD. */");
  return lines.join("\n");
}

function stripNamedReexports(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const ranges = sourceFile.statements
    .filter(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause),
    )
    .map((statement) => [statement.getFullStart(), statement.getEnd()]);
  let result = source;
  for (const [start, end] of ranges.toReversed()) {
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }
  return result;
}

function escapeTableCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderExportMap(inventories) {
  const lines = [
    "---",
    'title: "Complete v1 to v2 export map"',
    'description: "Every importable CopilotKit JavaScript and TypeScript v1 export, with its verified v2 replacement or an explicit no-direct-replacement marker."',
    "---",
    "",
    "This page is generated from the public package entrypoints. It is the exhaustive",
    "migration index for humans and coding agents. A row only names a v2 replacement",
    "when that export actually exists; otherwise it directs you to the v2 migration guide",
    "instead of guessing at a superficially similar API.",
    "",
    `[Read the step-by-step migration guide](${MIGRATION_GUIDE}).`,
    "",
  ];
  for (const { entrypoint, exports } of inventories) {
    lines.push(
      `## \`${entrypoint.importPath}\``,
      "",
      "| v1 export (deprecated; use v2 instead) | Exact v2 replacement | v2 source | Documentation |",
      "| --- | --- | --- | --- |",
    );
    for (const item of exports) {
      const replacement = item.replacement
        ? `\`${item.replacement.importLine}\`<br />\`${item.replacement.usageLine}\``
        : `No 1:1 replacement. Start with \`${entrypoint.v2ImportPath}\`.`;
      const source = item.replacement
        ? `\`${item.replacement.source}\``
        : `\`${entrypoint.v2Source}\``;
      const docs = item.replacement?.docs ?? V2_REFERENCE;
      lines.push(
        `| \`${escapeTableCell(item.name)}\` | ${escapeTableCell(replacement)} | ${escapeTableCell(source)} | [Open v2 docs](${docs}) |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const checkOnly = process.argv.includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");
if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
}

const { inventories } = getV1PublicApi();
const sourceItems = new Map();
for (const { exports } of inventories) {
  for (const item of exports) {
    if (!item.declarationFile) continue;
    const group = sourceItems.get(item.declarationFile) ?? [];
    group.push(item);
    sourceItems.set(item.declarationFile, group);
  }
}

const expectedFiles = new Map();
for (const [file, items] of sourceItems) {
  if (inventories.some(({ entrypoint }) => entrypoint.file === file)) continue;
  const absolutePath = path.join(repoRoot, file);
  const current = readFileSync(absolutePath, "utf8");
  const body = current.replace(noticePattern, "").replace(/^\s+/, "");
  expectedFiles.set(file, `${renderSourceNotice(items)}\n\n${body}`);
}

for (const { entrypoint, exports } of inventories) {
  const absolutePath = path.join(repoRoot, entrypoint.file);
  const current = readFileSync(absolutePath, "utf8");
  let body = current.replace(noticePattern, "").replace(exportBlockPattern, "");
  body = stripNamedReexports(body, entrypoint.file).trim();
  expectedFiles.set(
    entrypoint.file,
    `${renderEntrypointNotice(entrypoint, exports.length)}\n\n${body ? `${body}\n\n` : ""}${renderExportBlock(exports)}\n`,
  );
}

expectedFiles.set(
  "showcase/shell-docs/src/content/reference/v1/export-map.mdx",
  renderExportMap(inventories),
);

let stale = 0;
const staleFiles = [];
for (const [file, expected] of expectedFiles) {
  const absolutePath = path.join(repoRoot, file);
  const current = existsSync(absolutePath)
    ? readFileSync(absolutePath, "utf8")
    : null;
  const comparable = (value) =>
    file.endsWith("/reference/v1/export-map.mdx")
      ? value?.replace(/-{3,}/g, "---").replace(/\s+/g, " ").trim()
      : value;
  if (comparable(current) === comparable(expected)) continue;
  stale += 1;
  staleFiles.push(file);
  if (!checkOnly) writeFileSync(absolutePath, expected);
}

const exportCount = inventories.reduce(
  (sum, item) => sum + item.exports.length,
  0,
);
if (checkOnly && stale > 0) {
  console.error(
    `${stale} v1 deprecation file(s) are missing or stale:\n${staleFiles
      .map((file) => `- ${file}`)
      .join("\n")}\nRun ${path.relative(
      repoRoot,
      fileURLToPath(import.meta.url),
    )} to update them.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    checkOnly
      ? `Checked ${exportCount} v1 exports across ${expectedFiles.size} files.`
      : `Updated ${stale} of ${expectedFiles.size} files for ${exportCount} v1 exports.`,
  );
}
