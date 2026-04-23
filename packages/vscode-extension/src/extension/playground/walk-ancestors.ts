import type { ProviderChainEntry } from "./types";
import { serializeJsxProps } from "./serialize-props";

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

    const nextStack =
      node.type === "JSXElement" ? [...stack, node] : stack;

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

  return ancestors.map((el) => toProviderEntry(el, sourceText, filePath));
}

function toProviderEntry(
  jsxElement: any,
  sourceText: string,
  filePath: string,
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
  return {
    tagName,
    props,
    loc: { line: 0, column: start, endLine: 0, endColumn: end },
    filePath,
  };
}

function memberName(node: any): string {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    return `${memberName(node.object)}.${memberName(node.property)}`;
  }
  return "<anonymous>";
}
