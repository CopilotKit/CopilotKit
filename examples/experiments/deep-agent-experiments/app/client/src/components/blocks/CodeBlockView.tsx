import type { CodeBlock } from "../../lib/canvas-types";

export function CodeBlockView({ block }: { block: CodeBlock }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-gray-200">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
        <span className="text-xs text-gray-400">
          {block.filename ?? block.language}
        </span>
      </div>
      <pre className="p-4 bg-gray-900 text-gray-100 text-sm overflow-x-auto">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}
