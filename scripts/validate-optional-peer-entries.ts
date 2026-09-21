import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";

// An optional peer dependency is one the consumer may simply not install. That
// promise only holds if the entry points they DO import never reach it with a
// static import: ESM evaluates those eagerly, so one `import x from "optional"`
// anywhere in an entry's module graph turns "optional" into "required" and the
// consumer gets ERR_MODULE_NOT_FOUND before a single line of their code runs.
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
// TYPES reach for, this one checks what the published CODE reaches for.

/**
 * Entry points that already reach optional peers, with the reason.
 *
 * These predate #7278 and are the v1 service adapters: the root entry re-exports
 * `AnthropicAdapter`, `OpenAIAdapter`, `GroqAdapter` and the LangChain adapters,
 * each of which imports its SDK at module scope. Fixing that means making the v1
 * root lazy too, which is a separate change against a deprecated surface. Listed
 * here so it is a recorded fact rather than a silent one -- and so `express`
 * cannot quietly join the list.
 */
const KNOWN: Record<string, string> = {
  ".": "v1 root: the service adapters import their SDKs at module scope",
};

export interface PeerViolation {
  /** The `exports` subpath, as written in package.json. */
  entry: string;
  /** The optional peer the entry's static import graph reaches. */
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

/**
 * Static import and re-export specifiers of one module, top level only.
 *
 * `require()` and `import()` are deliberately NOT collected: both are call
 * expressions the module decides whether to evaluate, which is exactly the
 * escape hatch an optional peer is supposed to use.
 */
function staticSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.JS,
  );

  const found: string[] = [];
  for (const statement of source.statements) {
    const literal =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (literal && ts.isStringLiteral(literal)) found.push(literal.text);
  }
  return found;
}

/** Resolve a relative specifier the way Node resolves it inside the package. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, base + ".mjs", path.join(base, "index.mjs")];
  return (
    candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null
  );
}

/** Every bare specifier reachable from `entry` through static imports alone. */
export function reachableBareSpecifiers(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const queue = [entry];
  /** bare specifier -> the file that imports it */
  const bare = new Map<string, string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const specifier of staticSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier);
        if (next) queue.push(next);
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
    const target =
      condition && typeof condition === "object"
        ? (condition as Record<string, string>).import
        : undefined;
    if (!target) continue;

    const file = path.resolve(packageDir, target);
    if (!fs.existsSync(file)) continue;

    for (const [specifier, importer] of reachableBareSpecifiers(file)) {
      const peer = packageNameOf(specifier);
      if (!optional.has(peer)) continue;
      if (isDedicatedEntry(entry, peer)) continue;
      if (entry in KNOWN) continue;
      violations.push({
        entry,
        peer,
        file: path.relative(packageDir, importer),
        specifier,
      });
    }
  }
  return violations;
}

export function formatViolations(violations: PeerViolation[]): string {
  const lines = violations.map(
    (v) =>
      `  ${v.entry}  reaches optional peer "${v.peer}"  via ${v.file} (imports "${v.specifier}")`,
  );
  return [
    `Found ${violations.length} eager import(s) of an optional peer dependency.`,
    "An optional peer may not be installed. A static import makes the whole",
    "entry point unimportable for those consumers. Require it at call time",
    "instead, or move the export to an entry point dedicated to that peer.",
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

    const violations = findPeerViolations(resolved);
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
