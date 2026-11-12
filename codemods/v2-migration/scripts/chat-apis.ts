import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { charIndex } from "./offsets.ts";

type Node = SgNode<TS | TSX>;

/** Every comment the codemod adds starts with this. Same as in `codemod.ts`. */
const TODO = "TODO(copilotkit-2.0):";
const CHAT_GUIDE = "https://docs.copilotkit.ai/migrate/chat-2.0";

const LABELS_NOTE = `\`CopilotChatLabels\` has more keys in 2.0, so a complete labels object no longer type-checks. Start from \`...CopilotChatDefaultLabels\` (from "@copilotkit/core") and override only the keys you need: ${CHAT_GUIDE}#label-type`;

/** The renderer lists that are read-only in 2.0, and the setter for each. */
const RENDERER_LIST_SETTERS: Record<string, string> = {
  renderToolCalls: "setRenderToolCalls",
  renderActivityMessages: "setRenderActivityMessages",
};

/** Array methods that change the array in place. */
const MUTATING_METHODS = [
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
];

function rendererListNote(list: string) {
  return `\`${list}\` is a read-only array in 2.0. Pass a new list to \`copilotkit.${RENDERER_LIST_SETTERS[list]}([...])\` instead of changing it in place: ${CHAT_GUIDE}#renderer-lists`;
}

/** Inserts an inline TODO comment before `node`, unless it is already there. */
function commentBefore(node: Node, message: string, source: string) {
  const comment = `/* ${TODO} ${message} */`;
  const start = node.range().start.index;
  if (source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment)) {
    return undefined;
  }
  const edit: Edit = {
    startPos: start,
    endPos: start,
    insertedText: `${comment} `,
  };
  return edit;
}

/**
 * Puts a `// TODO` line above the statement `node`, at its indentation, unless
 * the line above already is that comment.
 */
function commentAbove(node: Node, message: string, source: string) {
  const comment = `// ${TODO} ${message}`;
  const start = node.range().start.index;
  const startChar = charIndex(source, start);
  const lineStart = source.lastIndexOf("\n", startChar - 1) + 1;
  const indent = source.slice(lineStart, startChar);
  const previousLineEnd = lineStart - 1;
  const previousLine = source
    .slice(source.lastIndexOf("\n", previousLineEnd - 1) + 1, previousLineEnd)
    .trim();
  if (previousLine === comment) return undefined;
  const edit: Edit = {
    startPos: start,
    endPos: start,
    insertedText: `${comment}\n${indent}`,
  };
  return edit;
}

/** Whether `node` is the `CopilotChatLabels` type, not `Partial<...>` of it. */
function isLabelsType(node: Node | null) {
  return node?.text().replace(/^:\s*/, "").trim() === "CopilotChatLabels";
}

/** An object literal with no spread, so it must list every label key. */
function isCompleteObject(node: Node | null) {
  return (
    node?.kind() === "object" &&
    !node.children().some((child) => child.kind() === "spread_element")
  );
}

/**
 * Marks complete `CopilotChatLabels` objects (`const labels: CopilotChatLabels
 * = { ... }` or `{ ... } satisfies CopilotChatLabels`). 2.0 adds label keys,
 * so the object no longer type-checks. Objects that spread another object are
 * left alone: they may spread the defaults.
 */
function labelObjectEdits(rootNode: Node, source: string) {
  if (!source.includes("CopilotChatLabels")) return [];
  const edits: Edit[] = [];

  const declarators = rootNode.findAll({
    rule: { kind: "variable_declarator" },
  });
  for (const declarator of declarators) {
    const isComplete =
      isLabelsType(declarator.field("type")) &&
      isCompleteObject(declarator.field("value"));
    if (!isComplete) continue;
    const statement = declarator.parent();
    const target =
      statement?.parent()?.kind() === "export_statement"
        ? statement.parent()
        : statement;
    const edit = target && commentAbove(target, LABELS_NOTE, source);
    if (edit) edits.push(edit);
  }

  const satisfies = rootNode.findAll({
    rule: { kind: "satisfies_expression" },
  });
  for (const expression of satisfies) {
    const [value, , type] = expression.children();
    const isComplete =
      isLabelsType(type ?? null) && isCompleteObject(value ?? null);
    if (!isComplete || !value) continue;
    const edit = commentBefore(value, LABELS_NOTE, source);
    if (edit) edits.push(edit);
  }

  return edits;
}

/**
 * Marks calls that change `renderToolCalls` or `renderActivityMessages` in
 * place (`copilotkit.renderToolCalls.push(...)`). Both are read-only arrays
 * in 2.0, and the core only sees a new list through its setter.
 */
function rendererListEdits(rootNode: Node, source: string) {
  const lists = Object.keys(RENDERER_LIST_SETTERS);
  if (!lists.some((list) => source.includes(list))) return [];
  const calls = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: {
        field: "function",
        kind: "member_expression",
        all: [
          {
            has: {
              field: "property",
              regex: `^(${MUTATING_METHODS.join("|")})$`,
            },
          },
          {
            has: {
              field: "object",
              kind: "member_expression",
              has: { field: "property", regex: `^(${lists.join("|")})$` },
            },
          },
        ],
      },
    },
  });

  const edits: Edit[] = [];
  for (const call of calls) {
    const list = call
      .field("function")
      ?.field("object")
      ?.field("property")
      ?.text();
    if (!list) continue;
    const statement = call.parent();
    const edit =
      statement?.kind() === "expression_statement"
        ? commentAbove(statement, rendererListNote(list), source)
        : commentBefore(call, rendererListNote(list), source);
    if (edit) edits.push(edit);
  }
  return edits;
}

/**
 * TODOs for chat APIs whose types got stricter in 2.0: complete label
 * objects, and renderer lists changed in place. Only files that import from
 * a CopilotKit package are read.
 */
export function chatApiEdits(rootNode: Node, source: string) {
  if (!source.includes("@copilotkit/")) return [];
  return [
    ...labelObjectEdits(rootNode, source),
    ...rendererListEdits(rootNode, source),
  ];
}
