import * as fs from "node:fs";
import * as path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";

// A published declaration file may only import modules a consumer can actually
// resolve after installing this package and nothing else. When it imports
// something they do not get -- a devDependency, an optional peer, a package
// whose types live in a devDependency `@types/*`, or a bundler chunk emitted as
// JavaScript only -- the consumer's build fails the moment they compile with
// `skipLibCheck: false`.
//
// That is OSS-899: a bare `import { CopilotRuntime } from "@copilotkit/runtime"`
// produced 81 errors under `strict` + `skipLibCheck: false`. Scaffolders all set
// `skipLibCheck: true`, so none of it was visible to us. This validator is the
// counterpart to validate-dts-ambient.ts: that one checks the *shape* of the
// declarations, this one checks what they *reach for*.

/** Modules that must never appear in a published declaration, with the reason. */
const FORBIDDEN: Record<string, string> = {
  "graphql-yoga":
    "the v1 GraphQL server is retired -- nothing serves GraphQL, and Yoga's " +
    "types drag lru-cache@10 into every consumer's program (5x TS2416)",
  "@graphql-yoga/plugin-defer-stream":
    "same retired v1 GraphQL server; not part of the public contract",
};

const DTS_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"];
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

export interface ImportViolation {
  /** Path to the declaration file, relative to the scanned directory. */
  file: string;
  /** 1-based line number of the offending import. */
  line: number;
  /** The module specifier as written. */
  specifier: string;
  /** Why a consumer cannot resolve it. */
  reason: string;
}

/** Collect every `.d.ts`/`.d.mts`/`.d.cts` file under `dir`, recursively. */
export function listDeclarationFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (DTS_SUFFIXES.some((s) => entry.name.endsWith(s)))
        found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

/** Every module specifier a declaration file imports or re-exports, with its line. */
function readSpecifiers(
  file: string,
): Array<{ specifier: string; line: number }> {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  const found: Array<{ specifier: string; line: number }> = [];
  const record = (node: ts.Node, literal: ts.Expression | undefined) => {
    if (!literal || !ts.isStringLiteral(literal)) return;
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    found.push({ specifier: literal.text, line: line + 1 });
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      record(statement, statement.moduleSpecifier);
    } else if (ts.isExportDeclaration(statement)) {
      record(statement, statement.moduleSpecifier);
    }
  }
  return found;
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Does a relative specifier point at something with declarations next to it?
 *
 * Bundlers emit shared helper chunks as JavaScript. tsdown's declaration output
 * imports those chunks by their runtime filename (`../_virtual/…/runtime.cjs`),
 * which has no sibling `.d.cts` -- a TS7016 for the consumer.
 */
function relativeTargetHasTypes(fromFile: string, specifier: string): boolean {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const withoutExt = base.replace(/\.(c|m)?js$/, "");
  const candidates = [
    ...DTS_SUFFIXES.map((s) => withoutExt + s),
    ...DTS_SUFFIXES.map((s) => path.join(base, "index" + s)),
    // A specifier that already names a declaration file resolves as written.
    ...(DTS_SUFFIXES.some((s) => base.endsWith(s)) ? [base] : []),
  ];
  return candidates.some((c) => fs.existsSync(c));
}

/** Does an installed package carry its own type declarations? */
function shipsOwnTypes(packageDir: string): boolean {
  const manifestPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(manifestPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.types || manifest.typings) return true;
  if (JSON.stringify(manifest.exports ?? {}).includes('"types"')) return true;
  return fs.existsSync(path.join(packageDir, "index.d.ts"));
}

/** Find an installed package by walking `node_modules` up from `start`. */
function findInstalled(start: string, name: string): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * Find declaration imports a consumer of this package cannot resolve.
 *
 * @param dir Directory of built declarations to scan (e.g. a package's `dist`).
 * @param packageRoot Package root holding the `package.json` that declares deps.
 */
export function findImportViolations(
  dir: string,
  packageRoot: string,
): ImportViolation[] {
  const manifest: Manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const deps = manifest.dependencies ?? {};
  const devDeps = manifest.devDependencies ?? {};
  const peers = manifest.peerDependencies ?? {};
  const peerMeta = manifest.peerDependenciesMeta ?? {};

  const violations: ImportViolation[] = [];

  for (const file of listDeclarationFiles(dir)) {
    for (const { specifier, line } of readSpecifiers(file)) {
      const add = (reason: string) =>
        violations.push({
          file: path.relative(dir, file),
          line,
          specifier,
          reason,
        });

      if (specifier.startsWith(".")) {
        if (!relativeTargetHasTypes(file, specifier)) {
          add("relative import has no declaration file next to it");
        }
        continue;
      }

      if (BUILTINS.has(specifier)) continue;

      const name = packageNameOf(specifier);

      if (FORBIDDEN[name]) {
        add(FORBIDDEN[name]);
        continue;
      }

      const isDep = name in deps;
      const isRequiredPeer = name in peers && !peerMeta[name]?.optional;

      if (!isDep && !isRequiredPeer) {
        if (name in peers)
          add("optional peer dependency -- consumers may not install it");
        else if (name in devDeps)
          add("devDependency -- consumers never install it");
        else add("not declared in dependencies or a required peer dependency");
        continue;
      }

      // Declared, but a consumer still gets no types if the package ships none
      // and its `@types/*` counterpart is not itself a real dependency.
      const installed = findInstalled(packageRoot, name);
      if (installed && !shipsOwnTypes(installed)) {
        const typesName = name.startsWith("@")
          ? `@types/${name.slice(1).replace("/", "__")}`
          : `@types/${name}`;
        if (!(typesName in deps)) {
          add(
            `ships no types; ${typesName} must be a dependency (it is ` +
              (typesName in devDeps ? "a devDependency" : "not declared") +
              ")",
          );
        }
      }
    }
  }

  return violations;
}

export function formatViolations(
  violations: ImportViolation[],
  dir: string,
): string {
  if (violations.length === 0) return "";
  const lines = violations.map(
    (v) =>
      `  ${path.join(dir, v.file)}:${v.line}  "${v.specifier}" -- ${v.reason}`,
  );
  return [
    `Found ${violations.length} unresolvable import(s) in published declarations.`,
    "A consumer installs this package and nothing else. Every module its .d.ts",
    "files import must be reachable from that install, or their build breaks on",
    "skipLibCheck: false.",
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
        `validate-dts-imports: ${dir} does not exist -- build the package first.`,
      );
      return 1;
    }

    const violations = findImportViolations(resolved, process.cwd());
    if (violations.length > 0) {
      console.error(formatViolations(violations, dir));
      failed = true;
    } else {
      const count = listDeclarationFiles(resolved).length;
      console.log(`validate-dts-imports: ${dir} clean (${count} files).`);
    }
  }

  return failed ? 1 : 0;
}

// Guard the CLI path so the exported helpers stay importable from tests.
if (process.argv[1] && process.argv[1].endsWith("validate-dts-imports.ts")) {
  process.exit(main(process.argv.slice(2)));
}
