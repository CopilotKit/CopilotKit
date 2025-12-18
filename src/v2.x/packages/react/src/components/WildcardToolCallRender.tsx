import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import { useState } from "react";

export const WildcardToolCallRender = defineToolCallRenderer({
  name: "*",
  render: ({ args, result, name, status }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const statusString = String(status) as
      | "inProgress"
      | "executing"
      | "complete";
    const isActive =
      statusString === "inProgress" || statusString === "executing";
    const isComplete = statusString === "complete";
    const statusStyles = isActive
      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400"
      : isComplete
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400"
        : "bg-zinc-100 text-zinc-800 dark:bg-zinc-700/40 dark:text-zinc-300";

    return (
      <div className="mt-2 pb-2">
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white/70 dark:bg-zinc-900/50 shadow-sm backdrop-blur p-4">
          <div
            className="flex items-center justify-between gap-3 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg
                className={`h-4 w-4 text-zinc-500 dark:text-zinc-400 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {name}
              </span>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusStyles}`}
            >
              {String(status)}
            </span>
          </div>

          {isExpanded && (
            <div className="mt-3 grid gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Arguments
                </div>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-800/60 p-3 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
                  {JSON.stringify(args ?? {}, null, 2)}
                </pre>
              </div>

              {result !== undefined && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Result
                  </div>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-800/60 p-3 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
                    {typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
});
