import type { Edit, SgNode } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";
import type TSX from "codemod:ast-grep/langs/tsx";
import { charIndex } from "./offsets.ts";

type Node = SgNode<TS | TSX>;

const TODO = "TODO(copilotkit-2.0):";

const COPY_BUTTONS = [
  "CopilotChatUserMessageCopyButton",
  "CopilotChatAssistantMessageCopyButton",
];

const COPIED_NOTE =
  "`copied` on the Angular copy buttons is a read-only signal in 2.0. Call `handleCopy()` to copy and show the check mark, or render your own button in the `copyButton` slot. See https://docs.copilotkit.ai/migrate/chat-2.0#angular-copy-buttons";

/**
 * Marks writes to `copied` (`.copied.set(...)`, `.copied.update(...)`) in a
 * file that imports an Angular copy button. The signal is read-only in 2.0,
 * and the right replacement depends on why the app set it, so the codemod
 * adds a TODO instead of a rewrite.
 */
export function angularCopyButtonEdits(rootNode: Node, source: string) {
  if (!importsCopyButton(rootNode)) return [];
  const writes = rootNode.findAll({
    rule: {
      kind: "call_expression",
      has: {
        field: "function",
        kind: "member_expression",
        all: [
          { has: { field: "property", regex: "^(set|update)$" } },
          {
            has: {
              field: "object",
              kind: "member_expression",
              has: { field: "property", regex: "^copied$" },
            },
          },
        ],
      },
    },
  });
  const edits: Edit[] = [];
  for (const write of writes) {
    const comment = `/* ${TODO} ${COPIED_NOTE} */`;
    const start = write.range().start.index;
    if (source.slice(0, charIndex(source, start)).trimEnd().endsWith(comment)) {
      continue;
    }
    edits.push({ startPos: start, endPos: start, insertedText: `${comment} ` });
  }
  return edits;
}

/** Whether the file imports a copy button from `@copilotkit/angular`. */
function importsCopyButton(rootNode: Node) {
  const imports = rootNode.findAll({
    rule: {
      kind: "import_statement",
      has: { field: "source", regex: "^[\"']@copilotkit/angular[\"']$" },
    },
  });
  return imports.some((statement) =>
    COPY_BUTTONS.some((name) =>
      new RegExp(`\\b${name}\\b`).test(statement.text()),
    ),
  );
}
