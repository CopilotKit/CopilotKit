#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  getV1PublicApi,
  renderDeprecationJsDoc,
  repoRoot,
} from "./v1-public-api.mjs";

export function annotateDeclarationText(source, items, file = "index.d.mts") {
  if (items.every((item) => source.includes(renderDeprecationJsDoc(item)))) {
    return source;
  }

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".cts") ? ts.ScriptKind.TS : ts.ScriptKind.TS,
  );
  const exportSpecifiers = new Map();
  const declarations = new Map();

  function visit(node) {
    if (ts.isExportSpecifier(node)) {
      exportSpecifiers.set(node.name.text, node);
    }
    if (
      node.name &&
      ts.isIdentifier(node.name) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const insertions = [];
  for (const item of items) {
    const node = exportSpecifiers.get(item.name) ?? declarations.get(item.name);
    if (!node) {
      throw new Error(`${file} does not export ${item.name}`);
    }
    const start = node.getStart(sourceFile);
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const indent = source.slice(lineStart, start).match(/^\s*/)?.[0] ?? "";
    const warning = renderDeprecationJsDoc(item)
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
    insertions.push({ start, text: `${warning}\n${indent}` });
  }

  let output = source;
  for (const insertion of insertions.sort(
    (left, right) => right.start - left.start,
  )) {
    output = `${output.slice(0, insertion.start)}${insertion.text}${output.slice(
      insertion.start,
    )}`;
  }
  return output;
}

function parseEntrypoints() {
  const index = process.argv.indexOf("--entrypoint");
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(
      "Usage: v1-dist-notices.mjs --entrypoint <id[,id...]> [--check]",
    );
  }
  const allowed = new Set(["--entrypoint", "--check", process.argv[index + 1]]);
  const unknown = process.argv.slice(2).filter((arg) => !allowed.has(arg));
  if (unknown.length > 0)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return new Set(process.argv[index + 1].split(","));
}

export function main() {
  const selected = parseEntrypoints();
  const checkOnly = process.argv.includes("--check");
  const { inventories } = getV1PublicApi();
  let stale = 0;
  let checkedExports = 0;

  for (const { entrypoint, exports } of inventories) {
    if (!selected.has(entrypoint.id)) continue;
    if (!entrypoint.distFiles?.length) {
      throw new Error(`No declaration outputs configured for ${entrypoint.id}`);
    }
    checkedExports += exports.length;
    for (const file of entrypoint.distFiles) {
      const absolutePath = path.join(repoRoot, file);
      if (!existsSync(absolutePath))
        throw new Error(`Missing declaration output: ${file}`);
      const current = readFileSync(absolutePath, "utf8");
      const expected = annotateDeclarationText(current, exports, file);
      if (current === expected) continue;
      stale += 1;
      if (!checkOnly) writeFileSync(absolutePath, expected);
    }
  }

  if (checkOnly && stale > 0) {
    console.error(
      `${stale} built v1 declaration file(s) lack deprecation warnings.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      checkOnly
        ? `Checked IDE warnings for ${checkedExports} built v1 exports.`
        : `Updated ${stale} declaration file(s) for ${checkedExports} v1 exports.`,
    );
  }
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;
if (isEntrypoint) {
  main();
}
