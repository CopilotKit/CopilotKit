import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { pilotMappings } from "./v1-source-mappings.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const noticePattern =
  /^\/\*\r?\n \* V1 SDK DEPRECATED\. USE V2 INSTEAD[\s\S]*? \* END V1 SDK DEPRECATED\. USE V2 INSTEAD NOTICE\r?\n \*\/\r?\n\r?\n/;

function findExportedDeclaration(sourceFile, exportName) {
  let declaration;

  function visit(node) {
    if (
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === exportName &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declaration;
}

function jsDocCommentText(comment) {
  if (typeof comment === "string") return comment;
  return comment?.map((part) => part.text).join("") ?? "";
}

function sourceWithoutPilotChanges(source, mapping) {
  const warning = ` * @deprecated The v1 SDK is deprecated. Use v2 instead. ${mapping.deprecationGuidance} See ${mapping.docs}`;
  return source
    .replace(noticePattern, "")
    .replace(`${warning}\n`, "")
    .replace("/**\n */\n", "");
}

for (const mapping of pilotMappings) {
  test(`${mapping.file} says the v1 SDK is deprecated and to use v2 instead`, () => {
    const source = readFileSync(path.join(repoRoot, mapping.file), "utf8");

    assert.ok(source.startsWith("/*\n * V1 SDK DEPRECATED. USE V2 INSTEAD"));
    assert.match(source, /AI CODING AGENTS:/);
    assert.doesNotMatch(source, /In most packages, v1 is the/);
    assert.doesNotMatch(source, /package root/);
    assert.ok(source.includes(mapping.v1));
    assert.ok(source.includes(mapping.v2));
    assert.ok(source.includes(`V2 replacement source: ${mapping.source}`));
    assert.ok(source.includes(`V2 docs: ${mapping.docs}`));
    assert.ok(existsSync(path.join(repoRoot, mapping.source)));
    for (const note of mapping.notes) {
      assert.ok(source.includes(`Migration note: ${note}`));
    }

    const notice = source.slice(
      0,
      source.indexOf("END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE"),
    );
    for (const noticeLine of notice
      .split("\n")
      .filter((candidate) => /deprecat/i.test(candidate))) {
      assert.match(noticeLine, /use v2 instead/i);
    }
  });

  test(`${mapping.deprecatedExport} is IDE-deprecated with its v2 replacement`, () => {
    const source = readFileSync(path.join(repoRoot, mapping.file), "utf8");
    const sourceFile = ts.createSourceFile(
      mapping.file,
      source,
      ts.ScriptTarget.Latest,
      true,
      mapping.file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const declaration = findExportedDeclaration(
      sourceFile,
      mapping.deprecatedExport,
    );

    assert.ok(declaration, `Missing export ${mapping.deprecatedExport}`);
    const deprecatedTag = ts
      .getJSDocTags(declaration)
      .find((tag) => tag.tagName.text === "deprecated");
    assert.ok(
      deprecatedTag,
      `Missing @deprecated on ${mapping.deprecatedExport}`,
    );

    const warning = jsDocCommentText(deprecatedTag.comment);
    assert.match(warning, /The v1 SDK is deprecated\. Use v2 instead\./);
    assert.ok(warning.includes(mapping.deprecationGuidance));
    assert.ok(warning.includes(mapping.docs));
  });

  test(`${mapping.file} has no unrelated source changes`, () => {
    const source = readFileSync(path.join(repoRoot, mapping.file), "utf8");
    const focusedSource = sourceWithoutPilotChanges(source, mapping);
    const actualHash = createHash("sha256").update(focusedSource).digest("hex");

    assert.equal(actualHash, mapping.baselineHash);
  });
}
