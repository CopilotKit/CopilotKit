import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

import {
  isDeferred,
  parse,
  targetsOf,
  walkEagerGraph,
} from "./validate-optional-peer-entries";

// Cloudflare Workers (workerd) leave `import.meta.url` undefined. A call to
// `createRequire(import.meta.url)` that runs while a module initializes
// therefore throws, and the Worker fails to start before it serves a single
// request. That is #6919: the runtime imported its own package.json, the
// bundler compiled the JSON into a CommonJS wrapper, and the wrapper's shared
// helper module made exactly that call at load.
//
// A `createRequire(import.meta.url)` inside a function is fine: it runs only
// when called, which is how load-express.ts reaches Express. So this walks
// each ESM entry's eager module graph (shared with
// validate-optional-peer-entries.ts) and flags only the calls that run on load.
// CJS targets are skipped: they cannot use `import.meta`, and Workers load ESM.

/**
 * Entries already known to make the call at load, and why. The v1 root is not
 * a Workers target: its deprecated service adapters call require() for their
 * SDKs, and that is what the bundler's createRequire helper exists for.
 */
const KNOWN: Record<string, string> = {
  ".": "v1 root: the deprecated service adapters need the require helper",
};

export interface CreateRequireViolation {
  /** The `exports` subpath, as written in package.json. */
  entry: string;
  /** Path of the offending file, relative to the package directory. */
  file: string;
  /** 1-based line of the call. */
  line: number;
}

function isImportMetaUrl(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "url" &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

function calleeName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** 1-based lines of `createRequire(import.meta.url)` calls that run on load. */
export function moduleScopeCreateRequireLines(file: string): number[] {
  const source = parse(file);
  const lines: number[] = [];

  const visit = (node: ts.Node): void => {
    // Skipping a function also skips its parameter defaults, which run on call.
    if (isDeferred(node)) return;
    if (
      ts.isCallExpression(node) &&
      calleeName(node) === "createRequire" &&
      node.arguments.length > 0 &&
      isImportMetaUrl(node.arguments[0])
    ) {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      );
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return lines;
}

export function findCreateRequireViolations(
  packageDir: string,
): CreateRequireViolation[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );

  const violations: CreateRequireViolation[] = [];
  for (const [entry, condition] of Object.entries(manifest.exports ?? {})) {
    if (KNOWN[entry]) continue;
    for (const [format, target] of targetsOf(condition)) {
      if (format !== "esm") continue;
      const file = path.resolve(packageDir, target);
      if (!fs.existsSync(file)) continue;

      for (const reached of walkEagerGraph(file, "esm").files) {
        for (const line of moduleScopeCreateRequireLines(reached)) {
          violations.push({
            entry,
            file: path.relative(packageDir, reached),
            line,
          });
        }
      }
    }
  }
  return violations;
}

export function formatViolations(violations: CreateRequireViolation[]): string {
  return [
    `Found ${violations.length} createRequire(import.meta.url) call(s) that run on module load.`,
    "Cloudflare Workers leave import.meta.url undefined, so the entry point",
    "throws before it serves a request. Move the call inside the function",
    "that needs it. If a JSON import (such as package.json) put the bundler's",
    "require helper in the graph, replace the import with a build-time constant.",
    "",
    ...violations.map((v) => `  ${v.entry}  ${v.file}:${v.line}`),
  ].join("\n");
}

function main(argv: string[]): number {
  const dirs = argv.length > 0 ? argv : ["."];
  let failed = false;

  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(path.join(resolved, "package.json"))) {
      console.error(
        `validate-module-scope-create-require: ${dir} has no package.json.`,
      );
      return 1;
    }

    let violations: CreateRequireViolation[];
    try {
      violations = findCreateRequireViolations(resolved);
    } catch (error) {
      // A walk that cannot complete has proved nothing.
      console.error((error as Error).message);
      failed = true;
      continue;
    }

    if (violations.length > 0) {
      console.error(formatViolations(violations));
      failed = true;
    } else {
      console.log(`validate-module-scope-create-require: ${dir} clean.`);
    }
  }

  return failed ? 1 : 0;
}

// Guard the CLI path so the exported helpers stay importable from tests.
if (
  process.argv[1] &&
  process.argv[1].endsWith("validate-module-scope-create-require.ts")
) {
  process.exit(main(process.argv.slice(2)));
}
