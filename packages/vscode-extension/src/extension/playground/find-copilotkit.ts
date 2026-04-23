import { parseSync } from "oxc-parser";
import { buildLineOffsets, offsetToLineColumn } from "./ast-utils";

export interface CopilotKitNode {
  filePath: string;
  /** The JSX opening-element AST node; serializers use its attributes. */
  openingElement: any;
  /** The enclosing JSXElement node; ancestor walker uses this as the target. */
  jsxElement: any;
  loc: { line: number; column: number; endLine: number; endColumn: number };
}

const PREFILTER_STRING = "@copilotkit/react-core";

function hasCopilotKitImport(source: string): boolean {
  return source.includes(PREFILTER_STRING);
}

/**
 * Finds every JSXElement whose opening element resolves (through imports,
 * incl. aliasing) to `CopilotKit` from `@copilotkit/react-core`. Returns
 * empty if the file doesn't reference that package at all (prefilter).
 *
 * Single-pass: we match on JSXElement (not JSXOpeningElement), so both the
 * JSXElement and its opening element are captured in one traversal — no
 * second walk, no null-jsxElement filter.
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
      node.type === "JSXElement" &&
      node.openingElement?.type === "JSXOpeningElement" &&
      node.openingElement.name?.type === "JSXIdentifier" &&
      localToCanonical.has(node.openingElement.name.name)
    ) {
      const opening = node.openingElement;
      const start = offsetToLineColumn(opening.start ?? 0, lineOffsets);
      const end = offsetToLineColumn(opening.end ?? 0, lineOffsets);
      results.push({
        filePath,
        openingElement: opening,
        jsxElement: node,
        loc: {
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
        },
      });
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
