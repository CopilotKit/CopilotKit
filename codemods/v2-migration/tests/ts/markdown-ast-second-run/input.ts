import { parseStreamingMarkdownChunk } from "@copilotkit/markdown";
// TODO(copilotkit-2.0): The `@copilotkit/markdown` AST changed in 2.0. The node types include `math` (parsed only with the `enableMath` option), and a task-list item has `checked` and no `[ ]` or `[x]` marker in its text. Add a `math` case to exhaustive switches and maps keyed by node type, and read `checked` for task items: https://docs.copilotkit.ai/migrate/markdown-renderer#code-that-reads-the-ast
import type { StreamingMarkdownAstNode } from "@copilotkit/markdown";

export { parseStreamingMarkdownChunk };

export function label(node: StreamingMarkdownAstNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    default:
      return node.type;
  }
}
