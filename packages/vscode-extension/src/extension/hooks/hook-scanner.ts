import * as fs from "node:fs";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";
import { parseSync } from "oxc-parser";
import { getHookDef, isCopilotKitHook } from "./hook-registry";

export interface HookCallSite {
  filePath: string;
  hook: string;
  name: string | null;
  loc: { line: number; column: number; endLine: number; endColumn: number };
  category: "render" | "data";
}

const PREFILTER_STRINGS = ["@copilotkit/react-core", "@copilotkit/shared"];

// AST node types that can never contain nested hook call-sites. Short-circuits
// the visitor to avoid walking into identifier names, literal values, etc.
const LEAF_TYPES = new Set([
  "Identifier",
  "Literal",
  "StringLiteral",
  "NumericLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "RegExpLiteral",
  "BigIntLiteral",
  "TemplateElement",
  "ThisExpression",
  "Super",
  "Import",
  "PrivateIdentifier",
]);

function hasCopilotKitPrefix(source: string): boolean {
  return PREFILTER_STRINGS.some((p) => source.includes(p));
}

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Pre-computes line-start offsets for O(log n) offset→line/column conversion.
 */
function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineColumn(
  offset: number,
  lineOffsets: number[],
): { line: number; column: number } {
  // Binary search for the largest line-start offset ≤ offset.
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid]! <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return {
    line: lo + 1,
    column: offset - lineOffsets[lo]!,
  };
}

/**
 * Parse a file's content and return the hook call-sites within.
 *
 * Callers that already have the file's text in memory (e.g. an unsaved
 * editor buffer from a CodeLens provider) should call `scanContent`
 * directly so the lenses reflect the live buffer, not the last-saved
 * disk version.
 */
export function scanContent(filePath: string, content: string): HookCallSite[] {
  if (!hasCopilotKitPrefix(content)) return [];

  const lang = filePath.endsWith(".tsx") ? "tsx" : "ts";
  let ast: any;
  try {
    const res = parseSync(filePath, content, { lang, sourceType: "module" });
    if (res.errors.length > 0) return [];
    ast = res.program;
  } catch {
    return [];
  }

  return extractSites(filePath, content, ast);
}

export function scanFile(filePath: string): HookCallSite[] {
  const content = readFile(filePath);
  if (!content) return [];
  return scanContent(filePath, content);
}

function extractSites(
  filePath: string,
  content: string,
  ast: any,
): HookCallSite[] {
  const localToCanonical = new Map<string, string>();

  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    const src = typeof node.source?.value === "string" ? node.source.value : "";
    if (
      src !== "@copilotkit/react-core" &&
      src !== "@copilotkit/react-core/v2"
    ) {
      continue;
    }
    for (const spec of node.specifiers ?? []) {
      if (spec.type !== "ImportSpecifier") continue;
      const imported =
        spec.imported?.type === "Identifier" ? spec.imported.name : null;
      const local = spec.local?.name ?? imported;
      if (imported && local && isCopilotKitHook(imported)) {
        localToCanonical.set(local, imported);
      }
    }
  }

  if (localToCanonical.size === 0) return [];

  const lineOffsets = buildLineOffsets(content);
  const results: HookCallSite[] = [];
  const seen = new WeakSet<object>();

  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    // Short-circuit on leaf nodes that can never contain hook call-sites.
    if (LEAF_TYPES.has(node.type)) return;

    if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
      const canonical = localToCanonical.get(node.callee.name);
      if (canonical) {
        const def = getHookDef(canonical);
        if (def) {
          const firstArg = node.arguments?.[0];
          let name: string | null = null;
          if (firstArg?.type === "ObjectExpression") {
            const nameProp = firstArg.properties?.find(
              (p: any) =>
                p.type === "Property" &&
                !p.computed &&
                ((p.key?.type === "Identifier" && p.key.name === "name") ||
                  (p.key?.type === "Literal" && p.key.value === "name")),
            );
            if (nameProp && nameProp.value?.type === "Literal") {
              const v = nameProp.value.value;
              if (typeof v === "string") name = v;
            }
          }
          const start = offsetToLineColumn(node.start ?? 0, lineOffsets);
          const end = offsetToLineColumn(node.end ?? 0, lineOffsets);
          results.push({
            filePath,
            hook: canonical,
            name,
            loc: {
              line: start.line,
              column: start.column,
              endLine: end.line,
              endColumn: end.column,
            },
            category: def.category,
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const c of child) visit(c);
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child);
      }
    }
  };

  visit(ast);
  return results;
}

const HARDCODED_EXCLUDES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  "build",
  ".turbo",
  "out",
  // Test-framework conventions (Jest / Vitest). Fixture files commonly
  // import from @copilotkit/react-core to exercise the real runtime,
  // which would otherwise pollute the tree with non-user-code entries.
  "__tests__",
  "__fixtures__",
  "__mocks__",
]);

const SKIP_SUFFIXES = [".test.", ".spec.", ".stories."];

interface IgnoreScope {
  dir: string;
  ig: Ignore;
}

function isIgnoredByAny(filePath: string, stack: IgnoreScope[]): boolean {
  for (const { dir, ig } of stack) {
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) continue;
    const rel = path.relative(dir, filePath).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) continue;
    if (ig.ignores(rel)) return true;
  }
  return false;
}

/**
 * Upper bound on files considered by a single `scanWorkspace` pass.
 * The scanner walks synchronously on the extension host thread, so very
 * large workspaces would block it. Hitting this cap is a signal that the
 * user needs to add exclusions (via `.gitignore` or the hardcoded list)
 * rather than a silent truncation of legitimate results.
 */
const MAX_FILES_SCANNED = 20000;

export interface ScanWorkspaceResult {
  sites: HookCallSite[];
  /** True when the walk stopped early at `MAX_FILES_SCANNED`. */
  capped: boolean;
  /** Number of .ts/.tsx files considered before the cap tripped. */
  filesScanned: number;
}

/**
 * Walks the workspace once, inheriting any `.gitignore` encountered along the
 * way as a stack. Skips the hardcoded excludes (case-insensitive) and common
 * test-file suffixes, then runs `scanFile` on each remaining `.ts` / `.tsx`.
 *
 * Synchronous by design — the rest of the extension-host state machine
 * expects `scanWorkspace` to return a fresh snapshot before handing it to
 * the sidebar provider. A `MAX_FILES_SCANNED` guard keeps the walk bounded
 * on pathologically large workspaces; when it trips, `capped: true` is
 * returned so callers can surface a user-visible warning instead of
 * silently presenting a truncated list.
 */
export function scanWorkspace(workspaceDir: string): ScanWorkspaceResult {
  const results: HookCallSite[] = [];
  let filesSeen = 0;
  let capped = false;

  const walk = (dir: string, inherited: IgnoreScope[]): void => {
    if (capped) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // First: if this directory contains a .gitignore, load it and push to the
    // active stack so both sibling files and nested directories see it.
    let activeStack = inherited;
    for (const e of entries) {
      if (!e.isDirectory() && e.name === ".gitignore") {
        try {
          const content = fs.readFileSync(path.join(dir, e.name), "utf-8");
          activeStack = [...inherited, { dir, ig: ignore().add(content) }];
        } catch {
          /* ignore unreadable gitignore */
        }
        break;
      }
    }

    for (const e of entries) {
      if (capped) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (HARDCODED_EXCLUDES.has(e.name.toLowerCase())) continue;
        if (isIgnoredByAny(full, activeStack)) continue;
        walk(full, activeStack);
        continue;
      }
      if (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx")) continue;
      if (SKIP_SUFFIXES.some((s) => e.name.includes(s))) continue;
      if (isIgnoredByAny(full, activeStack)) continue;
      if (++filesSeen > MAX_FILES_SCANNED) {
        capped = true;
        return;
      }
      results.push(...scanFile(full));
    }
  };

  walk(workspaceDir, []);
  return { sites: results, capped, filesScanned: filesSeen };
}
