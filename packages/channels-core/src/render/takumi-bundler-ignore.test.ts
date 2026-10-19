import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect } from "vitest";

// `react` and `takumi-js` are optional peers, and `takumi-js` pulls a native
// `.node` binary. Apps reach this package through `@copilotkit/runtime/v2`
// (fetch-handler -> channels-intelligence -> channels-core), and app bundlers
// follow every literal import they can see. A static import, re-export or
// `require()`, or an `import()` without the ignore hints, puts the native
// binary into every app's server bundle: Turbopack then fails with
// "non-ecmascript placeable asset", and installs without the optional peer
// fail to resolve it at all.

const HINTS = ["webpackIgnore: true", "turbopackIgnore: true"];

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function isPeer(specifier: string): boolean {
  return (
    specifier === "react" ||
    specifier.startsWith("react/") ||
    specifier === "takumi-js" ||
    specifier.startsWith("takumi-js/") ||
    specifier.startsWith("@takumi-rs/")
  );
}

interface PeerLoad {
  file: string;
  specifier: string;
  kind: "import" | "export" | "require" | "import-equals" | "dynamic";
  comments: string;
}

function peerLoads(file: string): PeerLoad[] {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = path.relative(pkgDir, file);
  const found: PeerLoad[] = [];
  const add = (
    specifier: ts.Expression | undefined,
    kind: PeerLoad["kind"],
    comments = "",
  ) => {
    if (specifier && ts.isStringLiteral(specifier) && isPeer(specifier.text)) {
      found.push({ file: rel, specifier: specifier.text, kind, comments });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      add(node.moduleSpecifier, "import");
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      add(node.moduleSpecifier, "export");
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, "import-equals");
    }
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        add(arg, "require");
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && arg) {
        // The trivia between `import(` and the specifier holds the hints.
        add(arg, "dynamic", text.slice(arg.pos, arg.getStart(source)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function moduleFiles(dir: string, extensions: string[]): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter(
      (f) =>
        extensions.some((ext) => f.endsWith(ext)) &&
        !f.endsWith(".d.ts") &&
        !/\.test\.[jt]sx?$/.test(f),
    )
    .map((f) => path.join(dir, f));
}

function expectBundlerInvisible(files: string[], renderModule: string): void {
  expect(files).toContain(renderModule);
  const loads = files.flatMap(peerLoads);
  // Every peer load is an `import()` the bundlers are told to skip...
  expect(loads.filter((l) => l.kind !== "dynamic")).toEqual([]);
  for (const load of loads) {
    for (const hint of HINTS) expect(load.comments).toContain(hint);
  }
  // ...and both peers are still loaded, by their package names: a relative
  // path would not resolve from inside an app's server chunk.
  expect(
    new Set(
      loads
        .filter((l) => l.file === path.relative(pkgDir, renderModule))
        .map((l) => l.specifier),
    ),
  ).toEqual(new Set(["takumi-js", "react"]));
}

describe("optional render peers stay invisible to app bundlers", () => {
  it("source loads react and takumi-js only through ignored import()", () => {
    expectBundlerInvisible(
      moduleFiles(path.join(pkgDir, "src"), [".ts", ".tsx"]),
      path.join(pkgDir, "src/render/takumi.ts"),
    );
  });

  it("the published build keeps the ignore hints", () => {
    // `nx test` depends on `build`, so dist reflects the current source.
    const dist = path.join(pkgDir, "dist");
    expect(fs.existsSync(dist), `${dist} missing: run the build`).toBe(true);
    expectBundlerInvisible(
      moduleFiles(dist, [".js"]),
      path.join(dist, "render/takumi.js"),
    );
  });
});
