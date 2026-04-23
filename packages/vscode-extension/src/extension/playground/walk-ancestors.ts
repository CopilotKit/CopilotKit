import type { ProviderChainEntry } from "./types";
import { serializeJsxProps } from "./serialize-props";
import { buildLineOffsets, offsetToLineColumn } from "./ast-utils";

interface ImportInfo {
  source: string;
  imported: string;
  isDefault: boolean;
}

/**
 * Builds a map of local identifier → import origin by scanning the file's
 * top-level ImportDeclarations. Used to resolve ancestor tag names back to
 * their real import source so codegen can reconstruct the import statements.
 */
function buildImportMap(ast: any): Map<string, ImportInfo> {
  const map = new Map<string, ImportInfo>();
  for (const node of ast.body ?? []) {
    if (node.type !== "ImportDeclaration") continue;
    const source =
      typeof node.source?.value === "string" ? node.source.value : null;
    if (!source) continue;
    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportSpecifier") {
        const imported =
          spec.imported?.type === "Identifier" ? spec.imported.name : null;
        const local = spec.local?.name ?? imported;
        if (imported && local) {
          map.set(local, { source, imported, isDefault: false });
        }
      } else if (spec.type === "ImportDefaultSpecifier") {
        const local = spec.local?.name;
        if (local)
          map.set(local, { source, imported: "default", isDefault: true });
      }
      // Skip ImportNamespaceSpecifier — ancestors used via <Namespace.Member>
      // hit JSXMemberExpression which walk-ancestors already handles separately.
    }
  }
  return map;
}

/**
 * Walks the JSX tree from the root of the AST and records the ancestor
 * JSXElements of `target`. Returns outermost-first.
 *
 * Only walks JSX nodes within the same file. Cross-file ancestor walking
 * (where a wrapping `<Providers>` component lives in another module) is
 * deferred to Plan #2, which needs an import-graph walk for bundling anyway.
 */
export function walkSameFileAncestors(
  target: any,
  ast: any,
  sourceText: string,
  filePath: string,
): ProviderChainEntry[] {
  if (!target) return [];

  const ancestors: any[] = [];
  let found = false;

  const walk = (node: any, stack: any[]): void => {
    if (found || !node || typeof node !== "object") return;

    if (
      node === target ||
      (node.type === "JSXElement" &&
        typeof node.start === "number" &&
        node.start === target.start &&
        node.end === target.end)
    ) {
      ancestors.push(...stack);
      found = true;
      return;
    }

    const nextStack = node.type === "JSXElement" ? [...stack, node] : stack;

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (found) return;
          walk(c, nextStack);
        }
      } else if (child && typeof child === "object" && "type" in child) {
        walk(child, nextStack);
      }
    }
  };

  walk(ast, []);

  const lineOffsets = buildLineOffsets(sourceText);
  const importMap = buildImportMap(ast);

  return ancestors.map((el) =>
    toProviderEntry(el, sourceText, filePath, lineOffsets, importMap),
  );
}

function toProviderEntry(
  jsxElement: any,
  sourceText: string,
  filePath: string,
  lineOffsets: number[],
  importMap: Map<string, ImportInfo>,
): ProviderChainEntry {
  const opening = jsxElement.openingElement;
  const name = opening?.name;
  const tagName =
    name?.type === "JSXIdentifier"
      ? name.name
      : name?.type === "JSXMemberExpression"
        ? memberName(name)
        : "<anonymous>";
  const props = serializeJsxProps(opening, sourceText);
  const start = opening?.start ?? 0;
  const end = opening?.end ?? start;
  const startLC = offsetToLineColumn(start, lineOffsets);
  const endLC = offsetToLineColumn(end, lineOffsets);

  // Resolve import origin. For JSXMemberExpression (e.g. <Theme.Provider>),
  // the root identifier is what matters — look up "Theme" in the import map.
  const rootIdentifier =
    name?.type === "JSXIdentifier" ? name.name : rootNameOf(name);
  const importInfo = rootIdentifier ? importMap.get(rootIdentifier) : undefined;

  return {
    tagName,
    props,
    loc: {
      line: startLC.line,
      column: startLC.column,
      endLine: endLC.line,
      endColumn: endLC.column,
    },
    filePath,
    importSource: importInfo?.source ?? null,
    importedName: importInfo?.imported ?? null,
    isDefaultImport: importInfo?.isDefault ?? false,
  };
}

function memberName(node: any): string {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    return `${memberName(node.object)}.${memberName(node.property)}`;
  }
  return "<anonymous>";
}

function rootNameOf(node: any): string | null {
  if (!node) return null;
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") return rootNameOf(node.object);
  return null;
}
