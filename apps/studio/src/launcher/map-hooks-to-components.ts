/**
 * Walk an oxc-parser AST to find every function/component declaration, and
 * for a given source byte offset return the innermost function containing it.
 *
 * Used by the scanner to populate `ToolDescriptor.enclosingComponent` — the
 * React function that hosts each `useCopilotAction(...)` call site.
 *
 * Ported (and simplified) from
 * .chalk/references/vscode-extension/src/extension/playground/map-hooks-to-components.ts.
 * The reference implementation produces a full `ComponentWithHooks` shape and
 * emits warnings for orphan hooks; here we only need the *name* of the
 * enclosing function, so the API is tighter.
 *
 * **AST conventions matched by this module:**
 *   - oxc emits `start` / `end` byte offsets on every node.
 *   - Anonymous functions inherit their name from the surrounding declaration
 *     (variable name, `export default function foo`, etc.).
 *   - The visitor recurses into all object children except `loc` / `range` /
 *     `parent` (the latter is added by some visitors and creates cycles).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = any;

type FunctionInfo = {
  start: number;
  end: number;
  componentName: string;
};

/**
 * Collect every function-shaped node in the program, then return a lookup
 * closure: given a byte offset, find the innermost function that contains it.
 *
 * The lookup is O(n) on the function count (typically 2-30 per file) — fine
 * for the per-file scan budget. A sweep-line index would shave nothing
 * practical here.
 */
export function buildEnclosingComponentLookup(
  program: AstNode,
): (offset: number) => string | null {
  const functions = collectFunctions(program);

  return (offset: number) => {
    const fn = innermostFunctionContaining(functions, offset);
    if (!fn) return null;
    // The plan reserves `null` for "could not determine" and prefers the
    // hook be associated with *some* function name. `(anonymous)` is the
    // upstream convention; we keep it so log lines match the VS Code
    // extension's behavior.
    return fn.componentName;
  };
}

function collectFunctions(program: AstNode): FunctionInfo[] {
  const result: FunctionInfo[] = [];

  const consider = (node: AstNode, localName: string | null): void => {
    if (
      node.type !== "FunctionDeclaration" &&
      node.type !== "FunctionExpression" &&
      node.type !== "ArrowFunctionExpression"
    ) {
      return;
    }
    const inferredName =
      localName ??
      (node.id?.type === "Identifier" ? (node.id.name as string) : null) ??
      "(anonymous)";
    result.push({
      start: node.start ?? 0,
      end: node.end ?? 0,
      componentName: inferredName,
    });
  };

  const walk = (node: AstNode): void => {
    if (!node || typeof node !== "object") return;

    if (node.type === "FunctionDeclaration") {
      consider(node, null);
    } else if (node.type === "VariableDeclarator") {
      if (
        node.id?.type === "Identifier" &&
        (node.init?.type === "ArrowFunctionExpression" ||
          node.init?.type === "FunctionExpression")
      ) {
        consider(node.init, node.id.name);
        walk(node.init.body);
        return;
      }
    } else if (
      node.type === "ExportDefaultDeclaration" &&
      (node.declaration?.type === "ArrowFunctionExpression" ||
        node.declaration?.type === "FunctionExpression" ||
        node.declaration?.type === "FunctionDeclaration")
    ) {
      // Default-export function: `export default function Page() {...}` or
      // `export default () => {...}`. Walk both the declaration (to record
      // the function) and the body (to find nested components).
      consider(node.declaration, null);
      walk(node.declaration.body);
      return;
    }

    for (const key of Object.keys(node)) {
      // `loc` and `range` are estree metadata; `parent` is added by some
      // visitors. None of them point to children we'd want to revisit.
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c);
      } else if (child && typeof child === "object" && "type" in child) {
        walk(child);
      }
    }
  };
  walk(program);
  return result;
}

function innermostFunctionContaining(
  functions: FunctionInfo[],
  offset: number,
): FunctionInfo | null {
  let best: FunctionInfo | null = null;
  for (const fn of functions) {
    if (offset < fn.start || offset > fn.end) continue;
    if (!best) {
      best = fn;
      continue;
    }
    // Smaller range = deeper nesting. The plan only needs the innermost
    // function name, so we don't need a full parent chain.
    if (fn.end - fn.start < best.end - best.start) best = fn;
  }
  return best;
}
