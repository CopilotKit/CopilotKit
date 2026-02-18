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
      ? "cpk:bg-amber-100 cpk:text-amber-800 cpk:dark:bg-amber-500/15 cpk:dark:text-amber-400"
      : isComplete
        ? "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400"
        : "cpk:bg-zinc-100 cpk:text-zinc-800 cpk:dark:bg-zinc-700/40 cpk:dark:text-zinc-300";

    return (
      <div className="cpk:mt-2 cpk:pb-2">
        <div className="cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:dark:border-zinc-800/60 cpk:bg-white/70 cpk:dark:bg-zinc-900/50 cpk:shadow-sm cpk:backdrop-blur cpk:p-4">
          <div
            className="cpk:flex cpk:items-center cpk:justify-between cpk:gap-3 cpk:cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="cpk:flex cpk:items-center cpk:gap-2 cpk:min-w-0">
              <svg
                className={`cpk:h-4 cpk:w-4 cpk:text-zinc-500 cpk:dark:text-zinc-400 cpk:transition-transform ${
                  isExpanded ? "cpk:rotate-90" : ""
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
              <span className="cpk:inline-block cpk:h-2 cpk:w-2 cpk:rounded-full cpk:bg-blue-500" />
              <span className="cpk:truncate cpk:text-sm cpk:font-medium cpk:text-zinc-900 cpk:dark:text-zinc-100">
                {name}
              </span>
            </div>
            <span
              className={`cpk:inline-flex cpk:items-center cpk:rounded-full cpk:px-2 cpk:py-1 cpk:text-xs cpk:font-medium ${statusStyles}`}
            >
              {String(status)}
            </span>
          </div>

          {isExpanded && (
            <div className="cpk:mt-3 cpk:grid cpk:gap-4">
              <div>
                <div className="cpk:text-xs cpk:uppercase cpk:tracking-wide cpk:text-zinc-500 cpk:dark:text-zinc-400">
                  Arguments
                </div>
                <pre className="cpk:mt-2 cpk:max-h-64 cpk:overflow-auto cpk:rounded-md cpk:bg-zinc-50 cpk:dark:bg-zinc-800/60 cpk:p-3 cpk:text-xs cpk:leading-relaxed cpk:text-zinc-800 cpk:dark:text-zinc-200 cpk:whitespace-pre-wrap cpk:break-words">
                  {JSON.stringify(args ?? {}, null, 2)}
                </pre>
              </div>

              {result !== undefined && (
                <div>
                  <div className="cpk:text-xs cpk:uppercase cpk:tracking-wide cpk:text-zinc-500 cpk:dark:text-zinc-400">
                    Result
                  </div>
                  <pre className="cpk:mt-2 cpk:max-h-64 cpk:overflow-auto cpk:rounded-md cpk:bg-zinc-50 cpk:dark:bg-zinc-800/60 cpk:p-3 cpk:text-xs cpk:leading-relaxed cpk:text-zinc-800 cpk:dark:text-zinc-200 cpk:whitespace-pre-wrap cpk:break-words">
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
