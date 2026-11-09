import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

// A static check, shared by the generative UI packages, for the APIs that
// a JavaScript engine of the supported React Native range lacks. vitest runs
// on Node, which has all of them, so a test that runs the code cannot see a
// use. This reads the sources with the TypeScript parser instead: strings,
// template literals, regexes and comments are never mistaken for code, and
// a call split over several lines is one node.
//
// The policy (one list, for every package on the native path): react-native
// >=0.70 is the peer range. Its default engine, the Hermes it ships
// (tag hermes-2022-08-16-RNv0.70.0), has `Object.hasOwn`, the Error `cause`
// option and `findLast`, but not `Array.prototype.at`, `structuredClone`,
// `DOMException` or `Intl.PluralRules`. The same React Native still lets an
// app run on JavaScriptCore (Podfile `:hermes_enabled => false`) on iOS
// 12.4 and later, and the JavaScriptCore of iOS before 15.4 has none of
// `Object.hasOwn`, `findLast` and `Array.prototype.at`, nor (before 15) the
// Error `cause` option. So all of them are banned.
//
// A use behind a feature check opts out with a `// hermes-ok: <reason>`
// comment on the line where the use starts.

export interface BannedApi {
  name: string;
  instead: string;
}

const API = {
  hasOwn: {
    name: "Object.hasOwn",
    instead: "hasOwnKey from @copilotkit/shared/generative-ui",
  },
  errorOptions: {
    name: "Error options ({ cause })",
    instead: "set `cause` on the error after constructing it",
  },
  structuredClone: {
    name: "structuredClone",
    instead: "cloneValue from @copilotkit/shared",
  },
  at: { name: "Array.prototype.at", instead: "an index" },
  findLast: {
    name: "findLast / findLastIndex",
    instead: "a loop from the end",
  },
  pluralRules: { name: "Intl.PluralRules", instead: "a feature check" },
  domException: {
    name: "the DOMException global",
    instead: "a feature check",
  },
  windowLocation: {
    name: "window.location or window.open",
    instead: "a feature check",
  },
  locationHref: {
    name: "location.href or location.origin",
    instead: "a feature check",
  },
} satisfies Record<string, BannedApi>;

export const BANNED_APIS: readonly BannedApi[] = Object.values(API);

/** The Error constructors of the language, which take `options` second. */
const BUILTIN_ERRORS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
]);

function hasCauseProperty(node: ts.Expression | undefined) {
  return (
    node !== undefined &&
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        property.name !== undefined &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "cause",
    )
  );
}

function calleeName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
}

/** Is `node` an identifier read as a value (not a property name or a type)? */
function isValueIdentifier(node: ts.Identifier) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent))
    return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  )
    return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent))
    return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  return true;
}

function isIdentifierNamed(node: ts.Expression, name: string) {
  return ts.isIdentifier(node) && node.text === name;
}

/** The names of the global object, as a receiver: `globalThis.x`. */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

/**
 * Is `node` the global `name` read through the global object, as
 * `globalThis.name` or `globalThis["name"]` (or `window`, `self`, `global`)?
 */
function isGlobalMember(node: ts.Expression, name: string) {
  if (ts.isPropertyAccessExpression(node)) {
    return (
      node.name.text === name &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    );
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return (
      ts.isStringLiteralLike(key) &&
      key.text === name &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    );
  }
  return false;
}

function bannedAt(node: ts.Node): BannedApi | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text;
    const target = node.expression;
    if (name === "hasOwn" && isIdentifierNamed(target, "Object"))
      return API.hasOwn;
    if (name === "PluralRules" && isIdentifierNamed(target, "Intl"))
      return API.pluralRules;
    if (
      (name === "location" || name === "open") &&
      isIdentifierNamed(target, "window")
    )
      return API.windowLocation;
    if (
      (name === "href" || name === "origin") &&
      (isIdentifierNamed(target, "location") ||
        (ts.isPropertyAccessExpression(target) &&
          target.name.text === "location"))
    )
      return API.locationHref;
    if (
      (name === "at" || name === "findLast" || name === "findLastIndex") &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    )
      return name === "at" ? API.at : API.findLast;
    return undefined;
  }
  if (ts.isCallExpression(node)) {
    if (
      isIdentifierNamed(node.expression, "structuredClone") ||
      isGlobalMember(node.expression, "structuredClone")
    )
      return API.structuredClone;
    if (
      node.expression.kind === ts.SyntaxKind.SuperKeyword &&
      hasCauseProperty(node.arguments[1])
    )
      return API.errorOptions;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const name = calleeName(node.expression);
    const args = node.arguments ?? [];
    if (name !== undefined && name.endsWith("Error")) {
      if (BUILTIN_ERRORS.has(name) && args.length > 1) return API.errorOptions;
      if (args.some((arg) => hasCauseProperty(arg))) return API.errorOptions;
    }
    if (name === "AggregateError" && args.length > 2) return API.errorOptions;
  }
  if (
    ts.isIdentifier(node) &&
    node.text === "DOMException" &&
    isValueIdentifier(node)
  )
    return API.domException;
  return undefined;
}

/** The lines (1-based) that carry a `hermes-ok:` comment. */
function markedLines(source: ts.SourceFile) {
  const text = source.text;
  const lines = new Set<number>();
  const seen = new Set<number>();
  const record = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      if (!text.slice(range.pos, range.end).includes("hermes-ok:")) continue;
      lines.add(source.getLineAndCharacterOfPosition(range.pos).line + 1);
    }
  };
  const visit = (node: ts.Node) => {
    record(ts.getLeadingCommentRanges(text, node.getFullStart()));
    record(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(source);
  record(
    ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()),
  );
  return lines;
}

export interface ScanHit {
  line: number;
  api: BannedApi;
}

/** Every banned API in `code`, minus the lines marked `hermes-ok:`. */
export function scanSource(code: string, fileName = "source.tsx"): ScanHit[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const marked = markedLines(source);
  const hits: ScanHit[] = [];
  const visit = (node: ts.Node) => {
    const api = bannedAt(node);
    if (api) {
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!marked.has(line)) hits.push({ line, api });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** The module specifiers that `source` loads at runtime (not type-only). */
export function runtimeImports(code: string, fileName = "source.ts") {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (
        clause &&
        !clause.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly)
      )
        continue;
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      !statement.isTypeOnly
    ) {
      const clause = statement.exportClause;
      if (
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly)
      )
        continue;
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  // `import("x")` and `require("x")` anywhere in the file.
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        isIdentifierNamed(node.expression, "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function resolveFile(base: string) {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`cannot resolve the source of ${base}`);
}

export interface ShippedSources {
  /** Every source file reached from the entries, sorted. */
  files: string[];
  /** The bare specifiers reached, which `packages` does not map. */
  external: string[];
}

/**
 * The source files that `entries` load at runtime: relative imports,
 * followed recursively, and each bare specifier that `packages` maps to a
 * source entry of the monorepo.
 */
export function shippedSources(
  entries: string[],
  packages: Record<string, string> = {},
): ShippedSources {
  const files = new Set<string>();
  const external = new Set<string>();
  const queue = entries.map((entry) => resolveFile(entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of runtimeImports(readFileSync(file, "utf8"), file)) {
      if (specifier.startsWith(".")) {
        queue.push(resolveFile(resolve(dirname(file), specifier)));
      } else if (specifier in packages) {
        queue.push(resolveFile(packages[specifier]!));
      } else {
        external.add(specifier);
      }
    }
  }
  return { files: [...files].sort(), external: [...external].sort() };
}

/** The hits of `file`, as `file:line: API; use instead`. */
export function scanFile(file: string, label = file): string[] {
  return scanSource(readFileSync(file, "utf8"), file).map(
    ({ line, api }) => `${label}:${line}: ${api.name}; use ${api.instead}`,
  );
}
