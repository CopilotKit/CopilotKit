import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

// A `.d.ts` file is an ambient context: TypeScript only permits declarations,
// imports, and exports at its top level. Anything else is TS1036 ("Statements
// are not allowed in ambient contexts") for every consumer compiling with
// `skipLibCheck: false`.
//
// Bundlers are the usual way this breaks. tsdown applies a *string* `banner` to
// every emitted chunk including declarations, so a JS-shaped banner such as
// `require("reflect-metadata");` silently lands at line 1 of each published
// `.d.cts`. That shipped in @copilotkit/runtime and cost consumers 71 errors
// (OSS-899) -- invisible to us because every scaffolder sets
// `skipLibCheck: true`. This validator is the guard that makes it visible.

/** Top-level node kinds a declaration file is allowed to contain. */
const ALLOWED_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.NamespaceExportDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
  ts.SyntaxKind.MissingDeclaration,
]);

const DTS_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"];

export interface AmbientViolation {
  /** Path to the declaration file, relative to the scanned directory. */
  file: string;
  /** 1-based line number of the offending statement. */
  line: number;
  /** Source text of the offending statement, trimmed to one line. */
  snippet: string;
}

/** Collect every `.d.ts`/`.d.mts`/`.d.cts` file under `dir`, recursively. */
export function listDeclarationFiles(dir: string): string[] {
  const found: string[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (DTS_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(full);
      }
    }
  };

  walk(dir);
  return found.sort();
}

/**
 * Find top-level statements that are illegal in a declaration file.
 *
 * @param dir Directory of built declarations to scan (e.g. a package's `dist`).
 * @returns One violation per offending statement, in file then line order.
 */
export function findAmbientViolations(dir: string): AmbientViolation[] {
  const violations: AmbientViolation[] = [];

  for (const file of listDeclarationFiles(dir)) {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (ALLOWED_KINDS.has(statement.kind)) continue;
      const { line } = source.getLineAndCharacterOfPosition(
        statement.getStart(source),
      );
      violations.push({
        file: path.relative(dir, file),
        line: line + 1,
        snippet: statement.getText(source).split("\n")[0].trim(),
      });
    }
  }

  return violations;
}

export function formatViolations(
  violations: AmbientViolation[],
  dir: string,
): string {
  if (violations.length === 0) return "";
  const lines = violations.map(
    (v) => `  ${path.join(dir, v.file)}:${v.line}  ${v.snippet}`,
  );
  return [
    `Found ${violations.length} statement(s) in published declarations.`,
    "A .d.ts is an ambient context: only declarations, imports, and exports are",
    "allowed. Each of these is a TS1036 error for consumers on skipLibCheck: false.",
    "",
    ...lines,
  ].join("\n");
}

function main(argv: string[]): number {
  const dirs = argv.length > 0 ? argv : ["dist"];
  let failed = false;

  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      console.error(
        `validate-dts-ambient: ${dir} does not exist -- build the package first.`,
      );
      return 1;
    }

    const violations = findAmbientViolations(resolved);
    if (violations.length > 0) {
      console.error(formatViolations(violations, dir));
      failed = true;
    } else {
      const count = listDeclarationFiles(resolved).length;
      console.log(`validate-dts-ambient: ${dir} clean (${count} files).`);
    }
  }

  return failed ? 1 : 0;
}

// Guard the CLI path so the exported helpers stay importable from tests.
if (process.argv[1] && process.argv[1].endsWith("validate-dts-ambient.ts")) {
  process.exit(main(process.argv.slice(2)));
}
