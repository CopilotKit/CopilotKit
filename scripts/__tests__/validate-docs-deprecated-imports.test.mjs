import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deprecatedSymbolsByImportPath,
  findDeprecatedImports,
  importedNames,
  readBaseline,
  scanRepo,
} from "../validate-docs-deprecated-imports.mjs";

const deprecated = new Map([
  ["@copilotkit/runtime", new Set(["LangGraphHttpAgent", "CopilotRuntime"])],
  ["@copilotkit/sdk-js/langgraph", new Set(["zodState"])],
]);

test("reads a plain named import", () => {
  assert.deepEqual(
    findDeprecatedImports(
      "a.mdx",
      'import { LangGraphHttpAgent } from "@copilotkit/runtime";',
      deprecated,
    ),
    ["a.mdx\t@copilotkit/runtime\tLangGraphHttpAgent"],
  );
});

test("reads a type-only import, aliases and multi-specifier lists", () => {
  assert.deepEqual(importedNames("{ type A, B as C, D }"), ["A", "B", "D"]);
  assert.deepEqual(
    findDeprecatedImports(
      "a.mdx",
      'import type { LangGraphHttpAgent as Legacy } from "@copilotkit/runtime";',
      deprecated,
    ),
    ["a.mdx\t@copilotkit/runtime\tLangGraphHttpAgent"],
  );
});

test("reads a default import", () => {
  assert.deepEqual(importedNames("CopilotRuntime"), ["CopilotRuntime"]);
  assert.deepEqual(importedNames("Default, { A }"), ["A", "Default"]);
});

test("ignores a package we do not track and a symbol that is not deprecated", () => {
  assert.deepEqual(
    findDeprecatedImports(
      "a.mdx",
      'import { zodState } from "some-other-pkg";',
      deprecated,
    ),
    [],
  );
  assert.deepEqual(
    findDeprecatedImports(
      "a.mdx",
      'import { HttpAgent } from "@copilotkit/runtime";',
      deprecated,
    ),
    [],
  );
});

test("does not care that the snippet is not a compilable unit", () => {
  // PE-108: most documented code is an elided fragment. A parse-based check
  // would see none of this; the scan must.
  const fragment = [
    "// ...",
    'import { zodState } from "@copilotkit/sdk-js/langgraph";',
    "const graph = ...",
  ].join("\n");
  assert.deepEqual(findDeprecatedImports("a.mdx", fragment, deprecated), [
    "a.mdx\t@copilotkit/sdk-js/langgraph\tzodState",
  ]);
});

test("deduplicates a symbol imported twice in one file", () => {
  const twice =
    'import { zodState } from "@copilotkit/sdk-js/langgraph";\nimport { zodState } from "@copilotkit/sdk-js/langgraph";';
  assert.equal(findDeprecatedImports("a.mdx", twice, deprecated).length, 1);
});

test("the deprecated set is derived from the packages, not listed here", () => {
  const derived = deprecatedSymbolsByImportPath();
  assert.ok(
    derived.size >= 8,
    `expected the v1 entrypoints, got ${derived.size}`,
  );
  // The symbol the original incident taught, on both entrypoints that export it.
  assert.ok(derived.get("@copilotkit/runtime")?.has("LangGraphHttpAgent"));
  assert.ok(
    derived.get("@copilotkit/runtime/langgraph")?.has("LangGraphHttpAgent"),
  );
});

test("the checked-in baseline matches the tree", () => {
  // Fails if content changed without regenerating, in either direction.
  assert.deepEqual(scanRepo(), readBaseline());
});
