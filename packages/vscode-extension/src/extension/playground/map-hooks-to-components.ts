import { parseSync } from "oxc-parser";
import type { HookCallSite } from "../hooks/hook-scanner";
import type { ComponentWithHooks, ScanWarning } from "./types";
import {
  buildLineOffsets,
  lineColumnToOffset,
  offsetToLineColumn,
} from "./ast-utils";

interface FunctionInfo {
  node: any;
  start: number;
  end: number;
  componentName: string;
  exportName: string | null;
}

export interface MapResult {
  components: ComponentWithHooks[];
  warnings: ScanWarning[];
}

/**
 * Groups hook call sites by their enclosing function (= React component).
 * Returns a sorted list (by source start offset) of components plus any
 * warnings for hooks that couldn't be assigned to a component.
 */
export function mapHooksToComponents(
  filePath: string,
  content: string,
  sites: HookCallSite[],
): MapResult {
  if (sites.length === 0) return { components: [], warnings: [] };

  const lang = filePath.endsWith(".tsx") ? "tsx" : "ts";
  let ast: any;
  try {
    const res = parseSync(filePath, content, { lang, sourceType: "module" });
    if (res.errors.length > 0) return { components: [], warnings: [] };
    ast = res.program;
  } catch {
    return { components: [], warnings: [] };
  }

  const functions = collectFunctions(ast);
  const lineOffsets = buildLineOffsets(content);
  const siteOffsets = new Map<HookCallSite, number>();
  for (const s of sites)
    siteOffsets.set(s, lineColumnToOffset(s.loc.line, s.loc.column, content));

  const byFunction = new Map<FunctionInfo, HookCallSite[]>();
  const warnings: ScanWarning[] = [];

  for (const site of sites) {
    const offset = siteOffsets.get(site)!;
    const fn = innermostFunctionContaining(functions, offset);
    if (!fn) {
      warnings.push({
        kind: "hook-outside-component",
        filePath,
        message: `Hook ${site.hook}${site.name ? ` (${site.name})` : ""} is not inside a component; it will not be mounted in the chat playground.`,
        loc: { line: site.loc.line, column: site.loc.column },
      });
      continue;
    }
    const list = byFunction.get(fn) ?? [];
    list.push(site);
    byFunction.set(fn, list);
  }

  const components: ComponentWithHooks[] = [];
  for (const [fn, hooks] of byFunction) {
    const startLC = offsetToLineColumn(fn.start, lineOffsets);
    const endLC = offsetToLineColumn(fn.end, lineOffsets);
    components.push({
      filePath,
      exportName: fn.exportName,
      componentName: fn.componentName,
      loc: {
        line: startLC.line,
        column: startLC.column,
        endLine: endLC.line,
        endColumn: endLC.column,
      },
      hooks: hooks.sort((a, b) => a.loc.line - b.loc.line),
    });
  }
  components.sort((a, b) => a.loc.line - b.loc.line);

  return { components, warnings };
}

function collectFunctions(ast: any): FunctionInfo[] {
  const result: FunctionInfo[] = [];

  const defaultExportName = readDefaultExport(ast);
  const namedExports = readNamedExports(ast);

  const consider = (node: any, localName: string | null): void => {
    if (
      node.type !== "FunctionDeclaration" &&
      node.type !== "FunctionExpression" &&
      node.type !== "ArrowFunctionExpression"
    ) {
      return;
    }
    const inferredName =
      localName ??
      (node.id?.type === "Identifier" ? node.id.name : null) ??
      "(anonymous)";
    const exportName: string | null =
      defaultExportName === inferredName
        ? "default"
        : namedExports.has(inferredName)
          ? inferredName
          : null;
    result.push({
      node,
      start: node.start ?? 0,
      end: node.end ?? 0,
      componentName: inferredName,
      exportName,
    });
  };

  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;

    if (node.type === "FunctionDeclaration") {
      consider(node, null);
      // Recurse into body only — `id` is an Identifier, no functions inside.
    } else if (node.type === "VariableDeclarator") {
      if (
        node.id?.type === "Identifier" &&
        (node.init?.type === "ArrowFunctionExpression" ||
          node.init?.type === "FunctionExpression")
      ) {
        consider(node.init, node.id.name);
        // Skip re-visiting node.init below.
        // Still recurse into the function body (it may contain nested components).
        walk(node.init.body);
        return;
      }
    } else if (
      node.type === "ExportDefaultDeclaration" &&
      (node.declaration?.type === "ArrowFunctionExpression" ||
        node.declaration?.type === "FunctionExpression" ||
        node.declaration?.type === "FunctionDeclaration")
    ) {
      // Pass null so consider() infers the name from the function's own id;
      // readDefaultExport already recorded this function's name, so the
      // defaultExportName === inferredName check will fire correctly.
      consider(node.declaration, null);
      // Walk into the function body to find nested components but skip the
      // declaration node itself, which has already been recorded.
      walk(node.declaration.body);
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) for (const c of child) walk(c);
      else if (child && typeof child === "object" && "type" in child)
        walk(child);
    }
  };
  walk(ast);
  return result;
}

function readDefaultExport(ast: any): string | null {
  for (const node of ast.body ?? []) {
    if (node.type === "ExportDefaultDeclaration") {
      if (
        node.declaration?.type === "Identifier" &&
        typeof node.declaration.name === "string"
      ) {
        return node.declaration.name;
      }
      if (node.declaration?.id?.type === "Identifier") {
        return node.declaration.id.name;
      }
    }
  }
  return null;
}

function readNamedExports(ast: any): Set<string> {
  const set = new Set<string>();
  for (const node of ast.body ?? []) {
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration?.type === "FunctionDeclaration") {
        if (node.declaration.id?.type === "Identifier") {
          set.add(node.declaration.id.name);
        }
      } else if (node.declaration?.type === "VariableDeclaration") {
        for (const d of node.declaration.declarations ?? []) {
          if (d.id?.type === "Identifier") set.add(d.id.name);
        }
      } else if (Array.isArray(node.specifiers)) {
        for (const s of node.specifiers) {
          if (s.exported?.type === "Identifier") set.add(s.exported.name);
        }
      }
    }
  }
  return set;
}

function innermostFunctionContaining(
  fns: FunctionInfo[],
  offset: number,
): FunctionInfo | null {
  let best: FunctionInfo | null = null;
  for (const fn of fns) {
    if (offset < fn.start || offset > fn.end) continue;
    if (!best) {
      best = fn;
      continue;
    }
    if (fn.end - fn.start < best.end - best.start) best = fn;
  }
  return best;
}
