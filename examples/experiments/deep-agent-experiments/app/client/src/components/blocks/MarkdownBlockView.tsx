import type { MarkdownBlock } from "../../lib/canvas-types";

export function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  return (
    <div className="prose max-w-none">
      <pre className="whitespace-pre-wrap font-sans">{block.content}</pre>
    </div>
  );
}
