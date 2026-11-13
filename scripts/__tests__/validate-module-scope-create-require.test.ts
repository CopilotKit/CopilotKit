import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findCreateRequireViolations,
  moduleScopeCreateRequireLines,
} from "../validate-module-scope-create-require.js";

const created: string[] = [];

/** Writes `dist` files and a manifest whose exports map `entries`. */
function setup(
  dist: Record<string, string>,
  exports: Record<string, unknown>,
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-create-req-"));
  created.push(root);

  for (const [relative, contents] of Object.entries(dist)) {
    const full = path.join(root, "dist", relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", exports }),
  );
  return root;
}

function writeModule(contents: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-create-req-"));
  created.push(root);
  const file = path.join(root, "module.mjs");
  fs.writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe("moduleScopeCreateRequireLines", () => {
  it("flags the call the bundler's require helper makes at load", () => {
    // The shape rolldown emits in dist/_virtual/_rolldown/runtime.mjs.
    const file = writeModule(
      [
        'import { createRequire } from "node:module";',
        "var __require = /* @__PURE__ */ createRequire(import.meta.url);",
        "export { __require };",
      ].join("\n"),
    );
    expect(moduleScopeCreateRequireLines(file)).toEqual([2]);
  });

  it("flags a namespaced call", () => {
    const file = writeModule(
      [
        'import * as mod from "node:module";',
        'const pkg = mod.createRequire(import.meta.url)("../package.json");',
      ].join("\n"),
    );
    expect(moduleScopeCreateRequireLines(file)).toEqual([2]);
  });

  it("ignores a call inside a function body", () => {
    const file = writeModule(
      [
        'import { createRequire } from "node:module";',
        "export function load() {",
        '  return createRequire(import.meta.url)("express");',
        "}",
      ].join("\n"),
    );
    expect(moduleScopeCreateRequireLines(file)).toEqual([]);
  });

  it("ignores a call in a parameter default", () => {
    // The shape of load-express.ts: the default runs only when the function
    // is called without an argument.
    const file = writeModule(
      [
        'import { createRequire } from "node:module";',
        "export function loadExpress(requireFrom = createRequire(import.meta.url)) {",
        '  return requireFrom("express");',
        "}",
      ].join("\n"),
    );
    expect(moduleScopeCreateRequireLines(file)).toEqual([]);
  });

  it("ignores createRequire with an argument other than import.meta.url", () => {
    const file = writeModule(
      [
        'import { createRequire } from "node:module";',
        'const req = createRequire("/app/index.js");',
      ].join("\n"),
    );
    expect(moduleScopeCreateRequireLines(file)).toEqual([]);
  });
});

describe("findCreateRequireViolations", () => {
  it("reports a helper reached transitively from an ESM entry", () => {
    const root = setup(
      {
        "v2/index.mjs": 'export * from "./runtime.mjs";',
        "v2/runtime.mjs": 'import { __require } from "../_virtual/helper.mjs";',
        "_virtual/helper.mjs": [
          'import { createRequire } from "node:module";',
          "var __require = createRequire(import.meta.url);",
          "export { __require };",
        ].join("\n"),
      },
      { "./v2": { import: "./dist/v2/index.mjs" } },
    );

    expect(findCreateRequireViolations(root)).toEqual([
      {
        entry: "./v2",
        file: path.join("dist", "_virtual", "helper.mjs"),
        line: 2,
      },
    ]);
  });

  it("does not report a helper that no entry reaches", () => {
    const root = setup(
      {
        "v2/index.mjs": "export const VERSION = '1.0.0';",
        "_virtual/helper.mjs": [
          'import { createRequire } from "node:module";',
          "var __require = createRequire(import.meta.url);",
        ].join("\n"),
      },
      { "./v2": { import: "./dist/v2/index.mjs" } },
    );

    expect(findCreateRequireViolations(root)).toEqual([]);
  });

  it("skips CJS targets, which cannot use import.meta", () => {
    const root = setup(
      {
        "v2/index.cjs": 'const { createRequire } = require("node:module");',
      },
      { "./v2": { require: "./dist/v2/index.cjs" } },
    );

    expect(findCreateRequireViolations(root)).toEqual([]);
  });

  it("exempts only the v1 root", () => {
    const helper = [
      'import { createRequire } from "node:module";',
      "var __require = createRequire(import.meta.url);",
    ].join("\n");
    const root = setup(
      {
        "index.mjs": 'import "./_virtual/helper.mjs";',
        "v2/index.mjs": 'import "../_virtual/helper.mjs";',
        "_virtual/helper.mjs": helper,
      },
      {
        ".": { import: "./dist/index.mjs" },
        "./v2": { import: "./dist/v2/index.mjs" },
      },
    );

    expect(findCreateRequireViolations(root).map((v) => v.entry)).toEqual([
      "./v2",
    ]);
  });

  it("fails loudly when a relative import resolves to no file", () => {
    const root = setup(
      { "v2/index.mjs": 'import "./missing.mjs";' },
      { "./v2": { import: "./dist/v2/index.mjs" } },
    );

    expect(() => findCreateRequireViolations(root)).toThrow(
      /resolves to no file/,
    );
  });
});
