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

export function scanFile(filePath: string): HookCallSite[] {
  const content = readFile(filePath);
  if (!content || !hasCopilotKitPrefix(content)) return [];

  const lang = filePath.endsWith(".tsx") ? "tsx" : "ts";
  let ast: any;
  try {
    const res = parseSync(filePath, content, { lang, sourceType: "module" });
    if (res.errors.length > 0) return [];
    ast = res.program;
  } catch {
    return [];
  }

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

const HARDCODED_EXCLUDES = [
  "node_modules",
  "dist",
  ".git",
  ".next",
  "build",
  ".turbo",
  "out",
];

const SKIP_SUFFIXES = [".test.", ".spec.", ".stories."];

function loadGitignore(rootDir: string): Map<string, Ignore> {
  const byDir = new Map<string, Ignore>();

  function walkForIgnoreFiles(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (HARDCODED_EXCLUDES.includes(e.name)) continue;
        walkForIgnoreFiles(path.join(dir, e.name));
      } else if (e.name === ".gitignore") {
        try {
          const content = fs.readFileSync(path.join(dir, e.name), "utf-8");
          byDir.set(dir, ignore().add(content));
        } catch {
          /* ignore */
        }
      }
    }
  }

  walkForIgnoreFiles(rootDir);
  return byDir;
}

function isIgnored(
  filePath: string,
  rootDir: string,
  ignoreByDir: Map<string, Ignore>,
): boolean {
  for (const [dir, ig] of ignoreByDir) {
    if (!filePath.startsWith(dir + path.sep) && filePath !== dir) continue;
    const rel = path.relative(dir, filePath).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) continue;
    if (ig.ignores(rel)) return true;
  }
  return false;
}

export interface ScanWorkspaceOptions {
  roots?: string[];
}

export function scanWorkspace(
  workspaceDir: string,
  opts: ScanWorkspaceOptions = {},
): HookCallSite[] {
  const ignoreByDir = loadGitignore(workspaceDir);
  const results: HookCallSite[] = [];
  const roots = opts.roots?.length
    ? opts.roots.map((r) => path.resolve(workspaceDir, r))
    : [workspaceDir];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (HARDCODED_EXCLUDES.includes(e.name)) continue;
        if (isIgnored(full, workspaceDir, ignoreByDir)) continue;
        walk(full);
        continue;
      }
      if (!e.name.endsWith(".ts") && !e.name.endsWith(".tsx")) continue;
      if (SKIP_SUFFIXES.some((s) => e.name.includes(s))) continue;
      if (isIgnored(full, workspaceDir, ignoreByDir)) continue;
      results.push(...scanFile(full));
    }
  };

  for (const r of roots) walk(r);
  return results;
}
