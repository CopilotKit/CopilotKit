import { parseSync } from "oxc-parser";

export interface CopilotKitNode {
  filePath: string;
  /** The raw JSX opening-element AST node, passed to serializers later. */
  openingElement: any;
  /** The raw JSX element (or self-closing element) node. */
  jsxElement: any;
  loc: { line: number; column: number; endLine: number; endColumn: number };
}

const PREFILTER_STRING = "@copilotkit/react-core";

function hasCopilotKitImport(source: string): boolean {
  return source.includes(PREFILTER_STRING);
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLineColumn(
  offset: number,
  lineOffsets: number[],
): { line: number; column: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineOffsets[lo]! };
}

/**
 * Finds every JSX opening element that resolves (through imports, incl.
 * aliasing) to `CopilotKit` from `@copilotkit/react-core`. Returns empty
 * if the file doesn't reference that package at all (prefilter short-
 * circuit — matches hook-scanner's pattern).
 */
export function findCopilotKitNodes(
  filePath: string,
  content: string,
): CopilotKitNode[] {
  if (!hasCopilotKitImport(content)) return [];

  const lang = filePath.endsWith(".tsx") ? "tsx" : "ts";
  let ast: any;
  try {
    const res = parseSync(filePath, content, { lang, sourceType: "module" });
    if (res.errors.length > 0) return [];
    ast = res.program;
  } catch {
    return [];
  }

  // Build alias map: local identifier → canonical export name.
  const localToCanonical = new Map<string, string>();
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    const src = typeof node.source?.value === "string" ? node.source.value : "";
    if (src !== "@copilotkit/react-core") continue;
    for (const spec of node.specifiers ?? []) {
      if (spec.type !== "ImportSpecifier") continue;
      const imported =
        spec.imported?.type === "Identifier" ? spec.imported.name : null;
      const local = spec.local?.name ?? imported;
      if (imported === "CopilotKit" && local) {
        localToCanonical.set(local, "CopilotKit");
      }
    }
  }

  if (localToCanonical.size === 0) return [];

  const lineOffsets = buildLineOffsets(content);
  const results: CopilotKitNode[] = [];
  const seen = new WeakSet<object>();

  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (
      node.type === "JSXOpeningElement" &&
      node.name?.type === "JSXIdentifier"
    ) {
      if (localToCanonical.has(node.name.name)) {
        const start = offsetToLineColumn(node.start ?? 0, lineOffsets);
        const end = offsetToLineColumn(node.end ?? 0, lineOffsets);
        results.push({
          filePath,
          openingElement: node,
          jsxElement: null,
          loc: {
            line: start.line,
            column: start.column,
            endLine: end.line,
            endColumn: end.column,
          },
        });
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

  // Second pass: for each opening element, find its enclosing JSXElement
  // (or JSXFragment) so Task 4 can walk ancestors.
  const matched = new Set(results.map((r) => r.openingElement));
  const walkWithJsxParent = (node: any, jsxParent: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXElement" && matched.has(node.openingElement)) {
      const target = results.find(
        (r) => r.openingElement === node.openingElement,
      )!;
      target.jsxElement = node;
    }
    const nextParent =
      node.type === "JSXElement" || node.type === "JSXFragment"
        ? node
        : jsxParent;
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const c of child) walkWithJsxParent(c, nextParent);
      } else if (child && typeof child === "object" && "type" in child) {
        walkWithJsxParent(child, nextParent);
      }
    }
  };
  walkWithJsxParent(ast, null);

  return results.filter((r) => r.jsxElement !== null);
}
