import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findAmbientViolations,
  formatViolations,
  listDeclarationFiles,
} from "../validate-dts-ambient.js";

function setupDist(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-dts-"));
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

describe("findAmbientViolations", () => {
  let dist: string;

  afterEach(() => {
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  it("flags the reflect-metadata require banner that shipped in OSS-899", () => {
    dist = setupDist({
      "index.d.cts": [
        'require("reflect-metadata");',
        'import { Foo } from "./foo.cjs";',
        "export { Foo };",
      ].join("\n"),
    });

    expect(findAmbientViolations(dist)).toEqual([
      { file: "index.d.cts", line: 1, snippet: 'require("reflect-metadata");' },
    ]);
  });

  it("accepts the ESM form of the same banner, which is a legal side-effect import", () => {
    dist = setupDist({
      "index.d.mts": [
        'import "reflect-metadata";',
        "export type A = string;",
      ].join("\n"),
    });

    expect(findAmbientViolations(dist)).toEqual([]);
  });

  it("accepts every declaration form a real .d.ts uses", () => {
    dist = setupDist({
      "index.d.ts": [
        'import type { X } from "./x.js";',
        'import Y = require("./y");',
        "type A = X;",
        "interface B { a: A }",
        "declare enum C { One }",
        "declare class D {}",
        "declare function e(): void;",
        "declare const f: number;",
        'declare module "g" {}',
        "declare global {}",
        "export { A, B, C, D, e, f };",
        "export default Y;",
        "export * from './h.js';",
        "export as namespace pkg;",
        ";",
      ].join("\n"),
    });

    expect(findAmbientViolations(dist)).toEqual([]);
  });

  it("reports control flow and assignment statements with their line numbers", () => {
    dist = setupDist({
      "a.d.ts": ["type A = 1;", "if (A) {}"].join("\n"),
      "nested/b.d.mts": ["export type B = 2;", "", "globalThis.x = 1;"].join(
        "\n",
      ),
    });

    expect(findAmbientViolations(dist)).toEqual([
      { file: "a.d.ts", line: 2, snippet: "if (A) {}" },
      {
        file: path.join("nested", "b.d.mts"),
        line: 3,
        snippet: "globalThis.x = 1;",
      },
    ]);
  });

  it("ignores non-declaration files that sit next to the declarations", () => {
    dist = setupDist({
      "index.cjs": 'require("reflect-metadata");',
      "index.d.cts": "export type A = string;",
      "index.d.cts.map": '{"version":3}',
    });

    expect(listDeclarationFiles(dist)).toEqual([
      path.join(dist, "index.d.cts"),
    ]);
    expect(findAmbientViolations(dist)).toEqual([]);
  });
});

describe("formatViolations", () => {
  it("returns an empty string when there is nothing to report", () => {
    expect(formatViolations([], "dist")).toBe("");
  });

  it("names the file, line, and offending source", () => {
    const message = formatViolations(
      [
        {
          file: "lib/logger.d.cts",
          line: 1,
          snippet: 'require("reflect-metadata");',
        },
      ],
      "dist",
    );

    expect(message).toContain("Found 1 statement(s)");
    expect(message).toContain("TS1036");
    expect(message).toContain(
      `${path.join("dist", "lib/logger.d.cts")}:1  require("reflect-metadata");`,
    );
  });
});
