import { ToolCallStatus } from "@copilotkitnext/core";
import { useState } from "react";

export interface DefaultApprovalRendererProps {
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result: string | undefined;
  respond?: (result: unknown) => Promise<void>;
}

/**
 * A generic approve/deny UI for unregistered tool calls that require user confirmation.
 * Rendered automatically when `defaultApproval` is enabled on CopilotKitProvider and
 * a backend tool call arrives without a matching `useHumanInTheLoop` registration.
 */
export function DefaultApprovalRenderer({
  name,
  args,
  status,
  result,
  respond,
}: DefaultApprovalRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusString = String(status) as
    | "inProgress"
    | "executing"
    | "complete";
  const isExecuting = statusString === "executing";
  const isComplete = statusString === "complete";

  const approved = isComplete && result === "approved";
  const denied = isComplete && !approved;

  return (
    <div className="cpk:mt-2 cpk:pb-2">
      <div className="cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:dark:border-zinc-800/60 cpk:bg-white/70 cpk:dark:bg-zinc-900/50 cpk:shadow-sm cpk:backdrop-blur cpk:p-4">
        {/* Header */}
        <div className="cpk:flex cpk:items-center cpk:gap-2 cpk:mb-3">
          <svg
            className="cpk:h-5 cpk:w-5 cpk:text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <span className="cpk:text-sm cpk:font-medium cpk:text-zinc-900 cpk:dark:text-zinc-100">
            Approval Required
          </span>
        </div>

        {/* Tool name and description */}
        <div className="cpk:mb-3">
          <p className="cpk:text-sm cpk:text-zinc-700 cpk:dark:text-zinc-300">
            The agent wants to execute{" "}
            <span className="cpk:font-mono cpk:text-xs cpk:bg-zinc-100 cpk:dark:bg-zinc-800 cpk:px-1.5 cpk:py-0.5 cpk:rounded">
              {name}
            </span>
          </p>
        </div>

        {/* Expandable arguments */}
        {args && Object.keys(args).length > 0 && (
          <div className="cpk:mb-3">
            <button
              type="button"
              className="cpk:text-xs cpk:text-zinc-500 cpk:dark:text-zinc-400 cpk:underline cpk:cursor-pointer"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? "Hide" : "Show"} arguments
            </button>
            {isExpanded && (
              <pre className="cpk:mt-2 cpk:max-h-48 cpk:overflow-auto cpk:rounded-md cpk:bg-zinc-50 cpk:dark:bg-zinc-800/60 cpk:p-3 cpk:text-xs cpk:leading-relaxed cpk:text-zinc-800 cpk:dark:text-zinc-200 cpk:whitespace-pre-wrap cpk:break-words">
                {JSON.stringify(args, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Action buttons (only in executing state) */}
        {isExecuting && respond && (
          <div className="cpk:flex cpk:gap-2">
            <button
              type="button"
              className="cpk:flex-1 cpk:rounded-lg cpk:bg-emerald-600 cpk:px-3 cpk:py-2 cpk:text-sm cpk:font-medium cpk:text-white cpk:hover:bg-emerald-700 cpk:transition-colors"
              onClick={() => respond("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className="cpk:flex-1 cpk:rounded-lg cpk:bg-red-600 cpk:px-3 cpk:py-2 cpk:text-sm cpk:font-medium cpk:text-white cpk:hover:bg-red-700 cpk:transition-colors"
              onClick={() => respond("denied")}
            >
              Deny
            </button>
          </div>
        )}

        {/* Result state */}
        {isComplete && (
          <div
            className={`cpk:flex cpk:items-center cpk:gap-2 cpk:rounded-lg cpk:px-3 cpk:py-2 cpk:text-sm cpk:font-medium ${
              approved
                ? "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400"
                : "cpk:bg-red-100 cpk:text-red-800 cpk:dark:bg-red-500/15 cpk:dark:text-red-400"
            }`}
          >
            {approved ? (
              <svg
                className="cpk:h-4 cpk:w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            ) : (
              <svg
                className="cpk:h-4 cpk:w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
            {approved ? "Approved" : "Denied"}
          </div>
        )}
      </div>
    </div>
  );
}
