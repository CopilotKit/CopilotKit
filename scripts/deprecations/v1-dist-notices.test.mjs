import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import ts from "typescript";
import { annotateDeclarationText } from "./v1-dist-notices.mjs";
import {
  getV1PublicApi,
  renderDeprecationJsDoc,
  repoRoot,
} from "./v1-public-api.mjs";

const inventory = getV1PublicApi();
const emitState = inventory.inventories
  .find(({ entrypoint }) => entrypoint.id === "sdk-js-langchain")
  .exports.find((item) => item.name === "copilotKitEmitState");

test("built declarations retain the deprecation notice", () => {
  const source = [
    "declare function copilotKitEmitState(): void;",
    "export { copilotKitEmitState };",
    "",
  ].join("\n");
  const annotated = annotateDeclarationText(source, [emitState]);

  assert.ok(annotated.includes(renderDeprecationJsDoc(emitState)));
  assert.equal(
    annotateDeclarationText(annotated, [emitState]),
    annotated,
    "annotation must be idempotent",
  );

  const program = ts.createProgram({
    rootNames: ["index.d.mts"],
    options: { module: ts.ModuleKind.ESNext },
    host: {
      ...ts.createCompilerHost({}),
      fileExists: (file) => file === "index.d.mts",
      readFile: (file) => (file === "index.d.mts" ? annotated : undefined),
      getSourceFile: (file, languageVersion) =>
        file === "index.d.mts"
          ? ts.createSourceFile(file, annotated, languageVersion, true)
          : undefined,
    },
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile("index.d.mts");
  const symbol = checker
    .getExportsOfModule(sourceFile.symbol)
    .find((candidate) => candidate.name === emitState.name);
  const tag = symbol
    .getJsDocTags(checker)
    .find((candidate) => candidate.name === "deprecated");
  const warning = tag.text.map((part) => part.text).join("");
  assert.match(warning, /No 1:1 v2 replacement is available\./);
  assert.match(warning, /Migration guide: /);
});

test("every v1 package build runs the declaration warning postprocessor", () => {
  const expected = new Map([
    [
      "packages/sdk-js/package.json",
      "--entrypoint sdk-js,sdk-js-langchain,sdk-js-langgraph-middlewares",
    ],
  ]);
  for (const [file, argument] of expected) {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, file)));
    assert.match(packageJson.scripts.build, /v1-dist-notices\.mjs/);
    assert.ok(packageJson.scripts.build.includes(argument));
  }
});
