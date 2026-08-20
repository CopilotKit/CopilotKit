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
const suggestions = inventory.inventories
  .find(({ entrypoint }) => entrypoint.id === "react-core")
  .exports.find((item) => item.name === "useCopilotChatSuggestions");

test("built declarations retain a copyable import-and-use deprecation example", () => {
  const source = [
    "declare function useCopilotChatSuggestions(): void;",
    "export { useCopilotChatSuggestions };",
    "",
  ].join("\n");
  const annotated = annotateDeclarationText(source, [suggestions]);

  assert.ok(annotated.includes(renderDeprecationJsDoc(suggestions)));
  assert.match(annotated, /Import and usage example:/);
  assert.match(
    annotated,
    /import \{ useConfigureSuggestions \} from "@copilotkit\/react-core\/v2";/,
  );
  assert.match(annotated, /useConfigureSuggestions\(\{/);
  assert.equal(
    annotateDeclarationText(annotated, [suggestions]),
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
    .find((candidate) => candidate.name === suggestions.name);
  const tag = symbol
    .getJsDocTags(checker)
    .find((candidate) => candidate.name === "deprecated");
  const warning = tag.text.map((part) => part.text).join("");
  assert.match(warning, /Import and usage example:/);
  assert.match(warning, /useConfigureSuggestions\(\{/);
});

test("every v1 package build runs the declaration warning postprocessor", () => {
  const expected = new Map([
    ["packages/react-core/package.json", "--entrypoint react-core"],
    ["packages/react-ui/package.json", "--entrypoint react-ui"],
    ["packages/react-textarea/package.json", "--entrypoint react-textarea"],
    ["packages/runtime/package.json", "--entrypoint runtime,runtime-langgraph"],
    [
      "packages/sdk-js/package.json",
      "--entrypoint sdk-js,sdk-js-langchain,sdk-js-langgraph,sdk-js-langgraph-middlewares",
    ],
    ["packages/vue/package.json", "--entrypoint vue"],
  ]);
  for (const [file, argument] of expected) {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, file)));
    assert.match(packageJson.scripts.build, /v1-dist-notices\.mjs/);
    assert.ok(packageJson.scripts.build.includes(argument));
  }
});
