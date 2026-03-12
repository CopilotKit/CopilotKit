import type { ChartBlock } from "../../lib/canvas-types";

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const maxValue = Math.max(...block.values, 1);

  return (
    <div className="my-4 p-4 border border-gray-200 rounded-lg bg-white">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{block.title}</h3>
      {block.chartType === "bar" && (
        <div className="space-y-2">
          {block.labels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 truncate">{label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all"
                  style={{ width: `${(block.values[i] / maxValue) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 w-12 text-right">{block.values[i]}</span>
            </div>
          ))}
        </div>
      )}
      {block.chartType !== "bar" && (
        <div className="text-sm text-gray-500 italic">
          {block.chartType} chart: {block.labels.join(", ")}
        </div>
      )}
    </div>
  );
}
