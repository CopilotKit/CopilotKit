"use client";

interface ToolCallCardProps {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status?: "executing" | "complete" | "inProgress";
}

// Check if args looks like a spread string (keys are "0", "1", "2", etc.)
function isSpreadString(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  // Check if all keys are sequential numbers starting from 0
  return keys.every((key, idx) => key === String(idx));
}

// Reconstruct string from spread object
function reconstructString(obj: Record<string, unknown>): string {
  return Object.values(obj).join("");
}

// Format result for display (truncate if too long)
function formatResult(res: unknown): string {
  if (res == null) return "";
  const str = typeof res === "string" ? res : JSON.stringify(res, null, 2);
  // Truncate very long results
  if (str.length > 500) {
    return str.slice(0, 500) + "\n... (truncated)";
  }
  return str;
}

export function ToolCallCard({
  name,
  args,
  result,
  status = "executing",
}: ToolCallCardProps) {
  const isExecuting = status === "executing" || status === "inProgress";
  const isComplete = status === "complete";

  // Format tool name for display (e.g., "create_task" -> "Create Task")
  const displayName = name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Handle edge case where args is a spread string (CopilotKit bug?)
  let displayArgs: Record<string, unknown> | string = args;
  if (isSpreadString(args)) {
    displayArgs = reconstructString(args);
  } else {
    // Filter out empty/null values from args for cleaner display
    displayArgs = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v != null && v !== ""),
    );
  }

  const formattedResult = result != null ? formatResult(result) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 my-2 max-w-md text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{isExecuting ? "⏳" : "✅"}</span>
        <span className="font-medium text-gray-700">{displayName}</span>
        {isExecuting && (
          <span className="text-xs text-gray-400 animate-pulse">
            Running...
          </span>
        )}
      </div>

      {/* Show args (input) */}
      {(typeof displayArgs === "string"
        ? displayArgs.length > 0
        : Object.keys(displayArgs).length > 0) && (
        <div className="mb-2">
          <span className="text-xs text-gray-500 font-medium">Input:</span>
          <pre className="text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto mt-1">
            {typeof displayArgs === "string"
              ? displayArgs
              : JSON.stringify(displayArgs, null, 2)}
          </pre>
        </div>
      )}

      {/* Show result when complete */}
      {isComplete && formattedResult && (
        <div>
          <span className="text-xs text-gray-500 font-medium">Result:</span>
          <pre className="text-xs text-green-700 bg-green-50 rounded p-2 overflow-x-auto mt-1 max-h-48 overflow-y-auto">
            {formattedResult}
          </pre>
        </div>
      )}
    </div>
  );
}
