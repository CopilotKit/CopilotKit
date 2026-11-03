import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

for (const filename of ["index.d.mts", "index.d.cts"]) {
  test(`${filename} retains textarea deprecation guidance`, () => {
    const file = fileURLToPath(new URL(`../dist/${filename}`, import.meta.url));
    const program = ts.createProgram([file], {
      module: ts.ModuleKind.NodeNext,
      types: [],
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file);
    assert.ok(source, `${filename} is missing`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    assert.ok(moduleSymbol, `${filename} has no module exports`);
    const exports = checker.getExportsOfModule(moduleSymbol);

    for (const name of ["CopilotTextarea", "CopilotTextareaProps"]) {
      const symbol = exports.find((candidate) => candidate.name === name);
      assert.ok(symbol, `${filename} does not export ${name}`);
      const tags = symbol
        .getJsDocTags(checker)
        .filter((tag) => tag.name === "deprecated");
      assert.equal(tags.length, 1, `${filename}: ${name}`);
      const warning = ts.displayPartsToString(tags[0].text);
      for (const text of [
        "Since 1.68.2. The v1 SDK is deprecated. Use v2 instead.",
        "No 1:1 v2 replacement is available.",
        "@copilotkit/react-core/v2",
        "https://docs.copilotkit.ai/",
        "https://docs.copilotkit.ai/reference/v2",
        "https://docs.copilotkit.ai/migrate/v2",
      ]) {
        assert.ok(warning.includes(text), `${filename}: ${name}: ${text}`);
      }
    }
  });
}
