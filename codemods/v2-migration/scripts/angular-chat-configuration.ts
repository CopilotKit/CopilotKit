import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";
const DOCS = "https://docs.copilotkit.ai/migrate/chat-2.0#chat-configuration";
const OVERRIDE_NOTE =
  "`CopilotChatConfiguration._setOverride` was removed in 2.0, and " +
  "`setActiveThreadId` and `startNewThread` do not call it. Override those " +
  `methods instead. See ${DOCS}`;

/** Local names of `CopilotChatConfiguration` imported from `@copilotkit/angular`. */
function configurationNames(rootNode: Node) {
  const names = new Set<string>();
  const imports = rootNode.findAll({ rule: { kind: "import_statement" } });
  for (const statement of imports) {
    if (
      statement.field("source")?.text().slice(1, -1) !== "@copilotkit/angular"
    )
      continue;
    const specifiers = statement.findAll({
      rule: { kind: "import_specifier" },
    });
    for (const specifier of specifiers) {
      if (specifier.field("name")?.text() !== "CopilotChatConfiguration")
        continue;
      names.add(specifier.field("alias")?.text() ?? "CopilotChatConfiguration");
    }
  }
  return names;
}

/**
 * Migrates subclasses of the Angular `CopilotChatConfiguration`, whose
 * protected `_setOverride(threadId, explicit)` 2.0 removed:
 *
 * - `this._setOverride(id, explicit)` becomes
 *   `this.setActiveThreadId(id, { explicit })`, which sets the same thread
 *   and is ignored (with a warning) when the thread is controlled;
 * - a class that defines its own `_setOverride` gets a TODO, because
 *   2.0 no longer calls it.
 *
 * Returns `null` when the file does not change.
 */
export function migrateAngularChatConfiguration(rootNode: Node) {
  const source = rootNode.text();
  const isCandidate =
    source.includes("@copilotkit/angular") && source.includes("_setOverride");
  if (!isCandidate) return null;
  const names = configurationNames(rootNode);
  if (names.size === 0) return null;

  const edits: Edit[] = [];
  const classes = rootNode.findAll({
    rule: { any: [{ kind: "class_declaration" }, { kind: "class" }] },
  });
  for (const declaration of classes) {
    const heritage = declaration
      .children()
      .find((child) => child.kind() === "class_heritage");
    const parent = heritage
      ?.find({ rule: { kind: "extends_clause" } })
      ?.field("value")
      ?.text();
    if (parent === undefined || !names.has(parent)) continue;

    const calls = declaration.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "member_expression",
          all: [
            { has: { field: "object", kind: "this" } },
            { has: { field: "property", regex: "^_setOverride$" } },
          ],
        },
      },
    });
    for (const call of calls) {
      const args = (call.field("arguments")?.children() ?? []).filter(
        (child) => child.isNamed() && child.kind() !== "comment",
      );
      const [threadId, explicit] = args;
      if (args.length !== 2 || !threadId || !explicit) continue;
      const value = explicit.text();
      const option = value === "explicit" ? "explicit" : `explicit: ${value}`;
      edits.push(
        call.replace(
          `this.setActiveThreadId(${threadId.text()}, { ${option} })`,
        ),
      );
    }

    const methods = declaration.findAll({
      rule: {
        kind: "method_definition",
        has: { field: "name", regex: "^_setOverride$" },
      },
    });
    for (const method of methods) {
      const start = method.range().start.index;
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const indent = source.slice(lineStart, start);
      const comment = `// ${TODO} ${OVERRIDE_NOTE}`;
      if (source.slice(0, lineStart).trimEnd().endsWith(comment)) continue;
      edits.push({
        startPos: start,
        endPos: start,
        insertedText: `${comment}\n${indent}`,
      });
    }
  }

  if (edits.length === 0) return null;
  return rootNode.commitEdits(edits);
}
