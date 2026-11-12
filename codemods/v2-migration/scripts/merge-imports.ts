import type { Edit } from "codemod:ast-grep";
import type { Node } from "./ast-helpers.ts";
import { byteIndex, charIndex } from "./offsets.ts";

/**
 * Merges named imports from the same `@copilotkit/*` module into the first of
 * them. The passes rename import sources one at a time, so a file that
 * imported from `@copilotkit/runtime/v2` and gets `createCopilotRuntimeHandler`
 * from `@copilotkit/runtime` would otherwise end with two imports of
 * `@copilotkit/runtime`.
 *
 * Only plain top-level `import { a, b as c } from "..."` statements merge.
 * Type-only imports, default and namespace imports, imports with comments,
 * and imports with a comment on the line above (the TODO of a removed name)
 * stay as they are.
 *
 * Returns the new source, or `null` when nothing changed.
 */
export function mergeCopilotKitImports(rootNode: Node): string | null {
  const source = rootNode.text();
  const groups = new Map<string, Node[]>();
  for (const statement of rootNode.findAll({
    rule: { kind: "import_statement" },
  })) {
    if (statement.parent()?.kind() !== "program") continue;
    const from = statement.field("source")?.text().slice(1, -1);
    if (!from?.startsWith("@copilotkit/")) continue;
    const text = statement.text();
    if (!/^import\s*\{[^}]*\}\s*from\s/.test(text)) continue;
    if (/\/\/|\/\*/.test(text)) continue;
    // A comment right above (a TODO for one of its names) stays with it.
    const start = charIndex(source, statement.range().start.index);
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const previousLine = source.slice(
      source.lastIndexOf("\n", lineStart - 2) + 1,
      Math.max(lineStart - 1, 0),
    );
    if (lineStart > 0 && /^\s*(\/\/|\/\*|\*)/.test(previousLine)) continue;
    groups.set(from, [...(groups.get(from) ?? []), statement]);
  }

  const edits: Edit[] = [];
  for (const [from, statements] of groups) {
    if (statements.length < 2) continue;
    const specifiers = [
      ...new Set(
        statements.flatMap((statement) =>
          statement
            .findAll({ rule: { kind: "import_specifier" } })
            .map((specifier) => specifier.text()),
        ),
      ),
    ];
    const [first, ...rest] = statements;
    const line = `import { ${specifiers.join(", ")} } from "${from}";`;
    edits.push(
      first!.replace(
        line.length <= 80
          ? line
          : `import {\n${specifiers.map((s) => `  ${s},`).join("\n")}\n} from "${from}";`,
      ),
    );
    for (const statement of rest) edits.push(deleteLine(statement, source));
  }
  return edits.length ? rootNode.commitEdits(edits) : null;
}

/** Deletes a statement with its line. */
function deleteLine(node: Node, source: string): Edit {
  let start = charIndex(source, node.range().start.index);
  let end = charIndex(source, node.range().end.index);
  while (start > 0 && /[ \t]/.test(source[start - 1]!)) start--;
  if (source[end] === "\n") end++;
  return {
    startPos: byteIndex(source, start),
    endPos: byteIndex(source, end),
    insertedText: "",
  };
}
