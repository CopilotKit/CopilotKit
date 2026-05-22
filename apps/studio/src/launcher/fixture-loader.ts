import { existsSync, promises as fs } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

import { parseSync } from "oxc-parser";

/**
 * M2 fixture loader.
 *
 * Given a component source file (the file containing a `useCopilotAction` /
 * `useRenderTool` / ... call site), discover an optional sibling
 * `*.fixture.{json,ts,tsx}` file and load its top-level presets.
 *
 * **Convention** (mirrors the VS Code A2UI catalog scanner —
 * .chalk/references/vscode-extension/src/extension/sidebar/component-scanner.ts
 * lines 25-79):
 *
 *   `app/components/StockChart.tsx`     → `app/components/StockChart.fixture.json`
 *   `app/components/StockChart/index.tsx`
 *      → `app/components/StockChart.fixture.json`  (parent-dir same name)
 *      → `app/components/StockChart/StockChart.fixture.json`  (in-dir same name)
 *
 * `.fixture.json` is preferred (round-trippable for the `fixture.save`
 * command); `.fixture.ts` and `.fixture.tsx` are supported read-only — the
 * loader pulls top-level object keys via the AST.
 *
 * Shape: each top-level key in the fixture file is a preset name; the value
 * is the argument payload the SPA will use to populate the form. Example:
 *
 * ```json
 * {
 *   "default":     { "ticker": "AAPL", "range": "1M" },
 *   "long-range":  { "ticker": "AAPL", "range": "5Y" }
 * }
 * ```
 *
 * **Failure modes** are intentionally soft — a malformed fixture file should
 * not crash the launcher. The loader returns `{ fixturePath: null, fixtures:
 * null }` with the `error` field populated; the launcher surfaces it as a
 * `scan.error` event so the SPA can show a non-fatal banner.
 */

const FIXTURE_EXTENSIONS = [
  ".fixture.json",
  ".fixture.ts",
  ".fixture.tsx",
] as const;

export type FixtureLoadResult = {
  /** Absolute path of the fixture file, or `null` when no sibling fixture exists. */
  fixturePath: string | null;
  /** Top-level keys → argument payload, or `null` when no fixture / unreadable. */
  fixtures: Record<string, unknown> | null;
  /** Set when the fixture file existed but couldn't be parsed. */
  error?: string;
};

/**
 * Find a sibling fixture file for `componentPath`. Returns the absolute
 * path of the first match in extension-preference order, or `null` when no
 * fixture exists.
 *
 * Order matches the VS Code reference: `.fixture.json`, `.fixture.ts`,
 * `.fixture.tsx`. For `index.{ts,tsx}` files the loader checks both the
 * parent-dir (component-name-as-file) and the in-dir (component-name-as-file
 * inside the index folder) locations so co-located fixtures work either way.
 */
export function findFixtureFile(componentPath: string): string | null {
  const dir = dirname(componentPath);
  const ext = extname(componentPath);
  const base = basename(componentPath, ext);
  const isIndex = base === "index";
  const name = isIndex ? basename(dir) : base;
  const searchDir = isIndex ? dirname(dir) : dir;

  // Primary search: same directory (or parent dir for index files).
  for (const fixtureExt of FIXTURE_EXTENSIONS) {
    const candidate = join(searchDir, `${name}${fixtureExt}`);
    if (existsSync(candidate)) return resolve(candidate);
  }

  // Secondary search for index files: also accept a fixture co-located
  // inside the same component directory.
  if (isIndex) {
    for (const fixtureExt of FIXTURE_EXTENSIONS) {
      const candidate = join(dir, `${name}${fixtureExt}`);
      if (existsSync(candidate)) return resolve(candidate);
    }
  }

  return null;
}

/**
 * Load the fixtures for a component source file. Always resolves; never
 * throws. When no sibling fixture exists, returns
 * `{ fixturePath: null, fixtures: null }`.
 */
export async function loadFixturesForComponent(
  componentPath: string,
): Promise<FixtureLoadResult> {
  const fixturePath = findFixtureFile(componentPath);
  if (!fixturePath) {
    return { fixturePath: null, fixtures: null };
  }
  return loadFixtureFile(fixturePath);
}

/**
 * Load a single fixture file by absolute path. Used both during initial
 * scan (via `loadFixturesForComponent`) and by the file watcher when a
 * fixture file changes on disk.
 *
 * JSON files are parsed directly. TS/TSX variants are AST-parsed; only the
 * top-level keys of the `export default { ... }` literal are extracted —
 * values that are object literals or trivial primitives are reified, anything
 * else (function calls, identifiers, computed expressions) becomes `null` so
 * the SPA can still surface the preset name as a chip. The actual computed
 * value lands in the SPA only when the user opens the preset (a future
 * milestone may evaluate TS fixtures in an isolated VM; for v1 the chip is
 * still useful because the user can apply it inside the running app where
 * the fixture module is already loaded).
 */
export async function loadFixtureFile(
  fixturePath: string,
): Promise<FixtureLoadResult> {
  let content: string;
  try {
    content = await fs.readFile(fixturePath, "utf8");
  } catch (err) {
    return {
      fixturePath,
      fixtures: null,
      error: `Failed to read fixture: ${(err as Error).message}`,
    };
  }

  if (fixturePath.endsWith(".json")) {
    return parseJsonFixture(fixturePath, content);
  }
  return parseTsFixture(fixturePath, content);
}

function parseJsonFixture(
  fixturePath: string,
  content: string,
): FixtureLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      fixturePath,
      fixtures: null,
      error: `Invalid JSON: ${(err as Error).message}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      fixturePath,
      fixtures: null,
      error: "Fixture file must be a JSON object",
    };
  }

  return {
    fixturePath,
    fixtures: parsed as Record<string, unknown>,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = any;

/**
 * Parse a `.fixture.ts` / `.fixture.tsx` file and extract the top-level keys
 * of its `export default` object literal. Each key's value is reified when
 * the AST shape is one we can serialize cheaply (object/array/literal); other
 * shapes collapse to `null` so the preset name still surfaces in the SPA.
 *
 * Shape we accept:
 *
 * ```ts
 * export default {
 *   default: { ticker: "AAPL", range: "1M" },
 *   "long-range": { ticker: "AAPL", range: "5Y" },
 * };
 * ```
 *
 * Also supported (less common): `export const fixtures = { ... }; export
 * default fixtures;` — when the default export is an `Identifier` we walk
 * back to the matching `VariableDeclaration` initializer.
 */
function parseTsFixture(
  fixturePath: string,
  content: string,
): FixtureLoadResult {
  const lang = fixturePath.endsWith(".tsx") ? "tsx" : "ts";
  let program: AstNode;
  try {
    const res = parseSync(fixturePath, content, { lang, sourceType: "module" });
    if (res.errors && res.errors.length > 0) {
      const first = res.errors[0]!;
      const message =
        typeof first.message === "string"
          ? first.message
          : "Parse error (no message)";
      return {
        fixturePath,
        fixtures: null,
        error: message,
      };
    }
    program = res.program as AstNode;
  } catch (err) {
    return {
      fixturePath,
      fixtures: null,
      error: (err as Error).message ?? "Parse failed",
    };
  }

  const objectExpr = findDefaultExportedObject(program);
  if (!objectExpr) {
    return {
      fixturePath,
      fixtures: null,
      error:
        "TS fixture must export a default object literal " +
        "(e.g. `export default { default: { ... } }`)",
    };
  }

  const fixtures: Record<string, unknown> = {};
  for (const prop of objectExpr.properties ?? []) {
    if (prop.type !== "Property" && prop.type !== "ObjectProperty") continue;
    const key = readPropertyKey(prop);
    if (!key) continue;
    fixtures[key] = reifyAstValue(prop.value);
  }

  return { fixturePath, fixtures };
}

/**
 * Walk the program body looking for `export default <ObjectExpression>` —
 * or `export default <Identifier>` whose binding resolves to an
 * `ObjectExpression`. Returns `null` when neither shape is found.
 */
function findDefaultExportedObject(program: AstNode): AstNode | null {
  let directExport: AstNode | null = null;
  let identifierName: string | null = null;

  for (const node of program.body ?? []) {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (!decl) continue;
      if (decl.type === "ObjectExpression") {
        directExport = decl;
      } else if (decl.type === "Identifier") {
        identifierName = decl.name as string;
      } else if (
        decl.type === "TSAsExpression" &&
        decl.expression?.type === "ObjectExpression"
      ) {
        // `export default { ... } as const` / `as Record<...>`
        directExport = decl.expression;
      } else if (
        decl.type === "TSSatisfiesExpression" &&
        decl.expression?.type === "ObjectExpression"
      ) {
        // `export default { ... } satisfies Fixtures`
        directExport = decl.expression;
      }
    }
  }
  if (directExport) return directExport;
  if (!identifierName) return null;

  // Resolve `export default <Identifier>` against top-level
  // `const <Identifier> = { ... };`.
  for (const node of program.body ?? []) {
    if (node.type !== "VariableDeclaration") continue;
    for (const declarator of node.declarations ?? []) {
      if (
        declarator.type === "VariableDeclarator" &&
        declarator.id?.type === "Identifier" &&
        declarator.id.name === identifierName
      ) {
        const init = declarator.init;
        if (!init) continue;
        if (init.type === "ObjectExpression") return init;
        if (
          init.type === "TSAsExpression" &&
          init.expression?.type === "ObjectExpression"
        ) {
          return init.expression;
        }
        if (
          init.type === "TSSatisfiesExpression" &&
          init.expression?.type === "ObjectExpression"
        ) {
          return init.expression;
        }
      }
    }
  }

  return null;
}

function readPropertyKey(prop: AstNode): string | null {
  const key = prop.key;
  if (!key) return null;
  if (key.type === "Identifier") return key.name as string;
  if (key.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }
  if (key.type === "StringLiteral" && typeof key.value === "string") {
    return key.value;
  }
  return null;
}

/**
 * Best-effort AST node → JS value. Handles ObjectExpression,
 * ArrayExpression, and primitive literals. Anything else returns `null` so
 * the chip still surfaces but the payload is opaque — the SPA falls back to
 * an empty form / JSON editor for opaque payloads.
 */
function reifyAstValue(node: AstNode): unknown {
  if (!node || typeof node !== "object") return null;
  switch (node.type) {
    case "ObjectExpression": {
      const obj: Record<string, unknown> = {};
      for (const prop of node.properties ?? []) {
        if (prop.type !== "Property" && prop.type !== "ObjectProperty") {
          continue;
        }
        const key = readPropertyKey(prop);
        if (!key) continue;
        obj[key] = reifyAstValue(prop.value);
      }
      return obj;
    }
    case "ArrayExpression":
      return (node.elements ?? []).map((el: AstNode) => reifyAstValue(el));
    case "Literal":
      // oxc-parser may emit RegExpLiteral / BigIntLiteral via this type; we
      // serialize them as their string form so the JSON stays valid.
      if (node.value === null || node.value === undefined) return null;
      if (
        typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean"
      ) {
        return node.value;
      }
      return null;
    case "StringLiteral":
      return typeof node.value === "string" ? node.value : null;
    case "NumericLiteral":
      return typeof node.value === "number" ? node.value : null;
    case "BooleanLiteral":
      return typeof node.value === "boolean" ? node.value : null;
    case "NullLiteral":
      return null;
    case "UnaryExpression":
      // Handle `-1`, `+0`, etc. as a small ergonomic win.
      if (
        (node.operator === "-" || node.operator === "+") &&
        node.argument?.type === "NumericLiteral" &&
        typeof node.argument.value === "number"
      ) {
        return node.operator === "-"
          ? -node.argument.value
          : node.argument.value;
      }
      return null;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return reifyAstValue(node.expression);
    default:
      return null;
  }
}

/**
 * Detect whether a path is a fixture file. Used by the launcher's watcher
 * branch + by `index.ts` when classifying changed files.
 */
export function isFixtureFile(filePath: string): boolean {
  return FIXTURE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/**
 * Given a fixture path, return the candidate component source paths the
 * fixture could belong to (in preference order). Used by the watcher to map
 * a fixture-file change back to the affected tools.
 *
 * The pairing is the inverse of `findFixtureFile`. For
 * `app/components/StockChart.fixture.json`:
 *   - `app/components/StockChart.tsx`        ← primary
 *   - `app/components/StockChart.ts`         ← TS-only project
 *   - `app/components/StockChart/index.tsx`  ← index-folder layout
 *   - `app/components/StockChart/index.ts`
 *
 * The launcher checks each path against the live `byFile` index; whatever
 * exists is the affected file.
 */
export function candidateComponentPaths(fixturePath: string): string[] {
  const dir = dirname(fixturePath);
  const file = basename(fixturePath);
  // Strip the `.fixture.{json,ts,tsx}` suffix.
  const name = file.replace(/\.fixture\.(json|ts|tsx)$/, "");

  return [
    join(dir, `${name}.tsx`),
    join(dir, `${name}.ts`),
    join(dir, name, "index.tsx"),
    join(dir, name, "index.ts"),
  ];
}

/**
 * Write a single preset (`presetName → args`) back to disk, creating the
 * fixture file if it doesn't exist yet. Always writes `.fixture.json` —
 * TS/TSX fixtures are read-only (overwriting computed values would destroy
 * source).
 *
 * `componentPath` is the path of the component the preset belongs to; the
 * fixture file is colocated next to it per `findFixtureFile` conventions.
 *
 * Returns the path of the fixture file that was written and the merged
 * fixtures object so the launcher can broadcast a `fixture.changed` event
 * without re-reading from disk.
 */
export async function saveFixturePreset(args: {
  componentPath: string;
  presetName: string;
  presetArgs: unknown;
}): Promise<{ fixturePath: string; fixtures: Record<string, unknown> }> {
  const { componentPath, presetName, presetArgs } = args;

  // Prefer an existing JSON fixture; fall back to the conventional location
  // next to the component source. We refuse to write into a TS/TSX fixture
  // (that's a source file in disguise).
  const existing = findFixtureFile(componentPath);
  let targetPath: string;
  if (existing && existing.endsWith(".json")) {
    targetPath = existing;
  } else if (existing) {
    throw new Error(
      `Refusing to overwrite TS/TSX fixture at ${existing}. ` +
        "Delete it or convert it to .fixture.json before saving presets from the UI.",
    );
  } else {
    targetPath = defaultJsonFixturePath(componentPath);
  }

  // Merge with whatever's already on disk so concurrent edits don't clobber.
  let existingFixtures: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existingFixtures = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or malformed — start fresh.
  }

  const next: Record<string, unknown> = { ...existingFixtures };
  next[presetName] = presetArgs;

  const serialized = JSON.stringify(next, null, 2) + "\n";
  await fs.writeFile(targetPath, serialized, "utf8");

  return { fixturePath: resolve(targetPath), fixtures: next };
}

/**
 * Delete a preset from a fixture file. If the file ends up empty after the
 * delete, we leave an empty object on disk rather than removing the file —
 * the user committed that fixture file intentionally and we don't want the
 * UI to silently delete tracked artifacts. Returns the (possibly empty)
 * remaining fixtures.
 */
export async function deleteFixturePreset(args: {
  componentPath: string;
  presetName: string;
}): Promise<{
  fixturePath: string;
  fixtures: Record<string, unknown>;
} | null> {
  const { componentPath, presetName } = args;
  const fixturePath = findFixtureFile(componentPath);
  if (!fixturePath) return null;
  if (!fixturePath.endsWith(".json")) {
    throw new Error(
      `Refusing to edit TS/TSX fixture at ${fixturePath}. ` +
        "Delete presets manually from source.",
    );
  }

  const raw = await fs.readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fixturePath, fixtures: {} };
  }
  const obj = parsed as Record<string, unknown>;
  if (!(presetName in obj)) {
    return { fixturePath, fixtures: obj };
  }
  delete obj[presetName];
  await fs.writeFile(fixturePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
  return { fixturePath, fixtures: obj };
}

function defaultJsonFixturePath(componentPath: string): string {
  const dir = dirname(componentPath);
  const ext = extname(componentPath);
  const base = basename(componentPath, ext);
  const isIndex = base === "index";
  const name = isIndex ? basename(dir) : base;
  const searchDir = isIndex ? dirname(dir) : dir;
  return join(searchDir, `${name}.fixture.json`);
}
