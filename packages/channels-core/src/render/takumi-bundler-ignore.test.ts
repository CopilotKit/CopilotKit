import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect } from "vitest";

// `react` and `takumi-js` are optional peers, and `takumi-js` pulls a native
// `.node` binary. Apps reach this module through `@copilotkit/runtime/v2`
// (fetch-handler -> channels-intelligence -> channels-core), and app bundlers
// follow every literal import they can see. A static import, or an `import()`
// without the ignore hints, puts the native binary into every app's server
// bundle: Turbopack then fails with "non-ecmascript placeable asset", and
// installs without the optional peer fail to resolve it at all.

const PEERS = ["takumi-js", "react"];
const HINTS = ["webpackIgnore: true", "turbopackIgnore: true"];

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

interface PeerLoad {
  specifier: string;
  kind: "static" | "dynamic";
  comments: string;
}

function peerLoads(file: string): PeerLoad[] {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: PeerLoad[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      PEERS.includes(node.moduleSpecifier.text) &&
      !node.importClause?.isTypeOnly
    ) {
      found.push({
        specifier: node.moduleSpecifier.text,
        kind: "static",
        comments: "",
      });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && PEERS.includes(arg.text)) {
        // The trivia between `import(` and the specifier holds the hints.
        const comments = text.slice(arg.pos, arg.getStart(source));
        found.push({ specifier: arg.text, kind: "dynamic", comments });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function expectBundlerInvisible(file: string): void {
  const loads = peerLoads(file);
  expect(loads.filter((l) => l.kind === "static")).toEqual([]);
  // Both peers are still loaded, by their package names: a relative path would
  // not resolve from inside an app's server chunk.
  expect(new Set(loads.map((l) => l.specifier))).toEqual(new Set(PEERS));
  for (const load of loads) {
    for (const hint of HINTS) expect(load.comments).toContain(hint);
  }
}

describe("render/takumi optional peers stay invisible to app bundlers", () => {
  it("source loads react and takumi-js only through ignored import()", () => {
    expectBundlerInvisible(path.join(pkgDir, "src/render/takumi.ts"));
  });

  it("the published build keeps the ignore hints", () => {
    // `nx test` depends on `build`, so dist reflects the current source.
    const built = path.join(pkgDir, "dist/render/takumi.js");
    expect(fs.existsSync(built), `${built} missing: run the build`).toBe(true);
    expectBundlerInvisible(built);
  });
});
