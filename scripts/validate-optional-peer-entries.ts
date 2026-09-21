import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

// An optional peer dependency is one the consumer may simply not install. That
// promise only holds if the entry points they DO import never reach it at
// module-initialization time: a static ESM import is evaluated eagerly, and so
// is a top-level `require()`, so one of either anywhere in an entry's module
// graph turns "optional" into "required" and the consumer gets a resolver error
// before a single line of their code runs.
//
// This is #7278: moving `express` from `dependencies` to an optional peer while
// `@copilotkit/runtime/v2` still re-exported the Express adapter would have
// broken every Hono and Next.js consumer, because the barrel's graph reached
// `import express from "express"`. Nothing caught it -- the workspace installs
// express for its own tests, so CI stayed green. The fix was to require express
// inside the factory instead; this validator is what keeps it that way.
//
// An entry may reach a peer that it is dedicated to: `./v2/express` is allowed
// to need `express`, because importing it IS asking for Express.
//
// Counterpart to validate-dts-imports.ts: that one checks what the published
// TYPES reach for, this one checks what the published CODE reaches for -- in
// both published formats, because a CJS consumer loads the `require` target and
// never evaluates the ESM one.

/**
 * Per entry point, the optional peers that entry is already known to reach, and
 * why.
 *
 * This one predates #7278: the v1 root re-exports `OpenAIAdapter`, which imports
 * the `openai` SDK at module scope (dist/service-adapters/openai/openai-adapter).
 * Making the v1 root lazy is a separate change against a deprecated surface, so
 * the fact is recorded here rather than left silent.
 *
 * The exemption is per PEER, not per entry. A blanket entry-level exemption
 * would also swallow the next peer to arrive -- including `express`, whose
 * absence from the v1 root's graph is exactly what this change had to arrange.
 */
const KNOWN: Record<string, { reason: string; peers: string[] }> = {
  ".": {
    reason: "v1 root: OpenAIAdapter imports the `openai` SDK at module scope",
    peers: ["openai"],
  },
};

/** Which published format a walk is following. */
export type Format = "esm" | "cjs";

/** Extension candidates used to resolve an extensionless relative specifier. */
const EXTENSIONS: Record<Format, string[]> = {
  esm: [".mjs", ".js"],
  cjs: [".cjs", ".js"],
};

export interface PeerViolation {
  /** The `exports` subpath, as written in package.json. */
  entry: string;
  /** Which of that subpath's targets reaches the peer. */
  format: Format;
  /** The optional peer the entry's eager module graph reaches. */
  peer: string;
  /** Path of the file holding the import, relative to the package directory. */
  file: string;
  /** The module specifier as written. */
  specifier: string;
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.JS,
  );
}

/**
 * Static import and re-export specifiers of one ESM module, top level only.
 *
 * `require()` and `import()` are deliberately NOT collected here: both are call
 * expressions the module decides whether to evaluate, which is exactly the
 * escape hatch an optional peer is supposed to use.
 */
function esmSpecifiers(file: string): string[] {
  const found: string[] = [];
  for (const statement of parse(file).statements) {
    const literal =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (literal && ts.isStringLiteral(literal)) found.push(literal.text);
  }
  return found;
}

/** Nodes whose body runs on call, not on module initialization. */
function isDeferred(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

/**
 * `require("x")` specifiers a CJS module evaluates when it is loaded.
 *
 * In a CJS bundle EVERY static import is emitted as a `require()` call, so the
 * ESM rule -- "a call expression is the escape hatch" -- cannot be applied
 * verbatim. What separates the two is WHERE the call sits: a `require()` at
 * module scope runs on load, and one inside a function body runs only if the
 * consumer calls that function. So the walk descends through statements and
 * blocks and stops at anything function-like. That is what makes the lazy
 * loader in endpoints/express.ts pass: its `createRequire(...)("express")` is
 * inside `loadExpress()`.
 */
function cjsSpecifiers(file: string): string[] {
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (isDeferred(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(parse(file), visit);
  return found;
}

function specifiersOf(file: string, format: Format): string[] {
  return format === "esm" ? esmSpecifiers(file) : cjsSpecifiers(file);
}

/** Resolve a relative specifier the way Node resolves it inside the package. */
export function resolveRelative(
  fromFile: string,
  specifier: string,
  format: Format,
): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...EXTENSIONS[format].map((extension) => base + extension),
    ...EXTENSIONS[format].map((extension) =>
      path.join(base, "index" + extension),
    ),
  ];
  return (
    candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null
  );
}

/**
 * Every bare specifier reachable from `entry` through eager loads alone.
 *
 * A relative specifier that does not resolve is an ERROR, not a dead end. The
 * walk would otherwise stop there and report a clean scan it never performed --
 * and a vacuous pass looks exactly like a real one. A renamed build extension
 * is enough to cause it.
 */
export function reachableBareSpecifiers(
  entry: string,
  format: Format = "esm",
): Map<string, string> {
  const seen = new Set<string>();
  const queue = [entry];
  /** bare specifier -> the file that imports it */
  const bare = new Map<string, string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of specifiersOf(file, format)) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier, format);
        if (!next) {
          throw new Error(
            `validate-optional-peer-entries: ${file} loads "${specifier}", ` +
              `which resolves to no file. The walk cannot continue, and a ` +
              `truncated walk reports a clean scan it has not performed.`,
          );
        }
        queue.push(next);
      } else if (!bare.has(specifier)) {
        bare.set(specifier, file);
      }
    }
  }
  return bare;
}

/**
 * Is `entry` the entry point dedicated to `peer`?
 *
 * `./v2/express` is dedicated to `express`; `./v2` is not. Matching on a path
 * segment keeps this derived from the exports map rather than configured.
 */
export function isDedicatedEntry(entry: string, peer: string): boolean {
  const leaf = packageNameOf(peer).split("/").pop();
  return entry.split("/").includes(leaf!);
}

/** The published targets of one exports entry, by format. */
function targetsOf(condition: unknown): Array<[Format, string]> {
  if (!condition || typeof condition !== "object") return [];
  const record = condition as Record<string, unknown>;
  const targets: Array<[Format, string]> = [];
  if (typeof record.import === "string") targets.push(["esm", record.import]);
  if (typeof record.require === "string") targets.push(["cjs", record.require]);
  return targets;
}

export function findPeerViolations(packageDir: string): PeerViolation[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const meta = manifest.peerDependenciesMeta ?? {};
  const optional = new Set(
    Object.keys(meta).filter((name) => meta[name]?.optional === true),
  );
  if (optional.size === 0) return [];

  const violations: PeerViolation[] = [];
  for (const [entry, condition] of Object.entries(manifest.exports ?? {})) {
    for (const [format, target] of targetsOf(condition)) {
      const file = path.resolve(packageDir, target);
      if (!fs.existsSync(file)) continue;

      for (const [specifier, importer] of reachableBareSpecifiers(
        file,
        format,
      )) {
        const peer = packageNameOf(specifier);
        if (!optional.has(peer)) continue;
        if (isDedicatedEntry(entry, peer)) continue;
        if (KNOWN[entry]?.peers.includes(peer)) continue;
        violations.push({
          entry,
          format,
          peer,
          file: path.relative(packageDir, importer),
          specifier,
        });
      }
    }
  }
  return violations;
}

export function formatViolations(violations: PeerViolation[]): string {
  const lines = violations.map(
    (v) =>
      `  ${v.entry} (${v.format})  reaches optional peer "${v.peer}"  via ${v.file} (loads "${v.specifier}")`,
  );
  return [
    `Found ${violations.length} eager load(s) of an optional peer dependency.`,
    "An optional peer may not be installed. Loading it at module scope makes",
    "the whole entry point unusable for those consumers. Require it at call",
    "time instead, or move the export to an entry point dedicated to that peer.",
    "",
    ...lines,
  ].join("\n");
}

function main(argv: string[]): number {
  const dirs = argv.length > 0 ? argv : ["."];
  let failed = false;

  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(path.join(resolved, "package.json"))) {
      console.error(
        `validate-optional-peer-entries: ${dir} has no package.json.`,
      );
      return 1;
    }

    let violations: PeerViolation[];
    try {
      violations = findPeerViolations(resolved);
    } catch (error) {
      // A walk that cannot complete has proved nothing. Fail loudly rather than
      // let a partial traversal read as a clean one.
      console.error((error as Error).message);
      failed = true;
      continue;
    }

    if (violations.length > 0) {
      console.error(formatViolations(violations));
      failed = true;
    } else {
      console.log(`validate-optional-peer-entries: ${dir} clean.`);
    }
  }

  return failed ? 1 : 0;
}

// Guard the CLI path so the exported helpers stay importable from tests.
if (
  process.argv[1] &&
  process.argv[1].endsWith("validate-optional-peer-entries.ts")
) {
  process.exit(main(process.argv.slice(2)));
}
