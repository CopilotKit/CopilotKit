import type { ContentBlock } from "../lib/canvas-types";
import {
  MarkdownBlockView,
  ChartBlockView,
  TableBlockView,
  CodeBlockView,
} from "./blocks";

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "markdown":
      return <MarkdownBlockView block={block} />;
    case "chart":
      return <ChartBlockView block={block} />;
    case "table":
      return <TableBlockView block={block} />;
    case "code":
      return <CodeBlockView block={block} />;
  }
}

export function ReportCanvas({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="h-full w-full p-8 bg-gray-50 overflow-auto border-l border-gray-200">
      <div className="max-w-3xl mx-auto bg-white shadow-xl p-10 min-h-[80vh] rounded-lg">
        {blocks.length === 0 ? (
          <p className="text-gray-400 italic">Waiting for agent...</p>
        ) : (
          blocks.map((block) => <BlockRenderer key={block.id} block={block} />)
        )}
      </div>
    </div>
  );
}
