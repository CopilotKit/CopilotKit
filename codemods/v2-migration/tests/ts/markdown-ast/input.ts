import { parseStreamingMarkdownChunk } from "@copilotkit/markdown";
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
