import { ToolCallStatus } from "@copilotkitnext/core";
import { useState } from "react";

/**
 * Checks if this tool call is a Microsoft Agent Framework "request_approval" call.
 * MAF sends approval requests with a specific structure:
 * { request: { approval_id, function_name, function_arguments, message } }
 */
function isMAFApproval(name: string, args: Record<string, unknown>): boolean {
  return name === "request_approval" && args?.request != null;
}

/**
 * Extracts the display-friendly function name from MAF approval args,
 * falling back to the raw tool call name.
 */
function getDisplayName(name: string, args: Record<string, unknown>): string {
  if (isMAFApproval(name, args)) {
    const request = args.request as Record<string, unknown>;
    return (request.function_name as string) ?? name;
  }
  return name;
}

/**
 * Extracts the relevant arguments to display.
 * For MAF approvals, shows the original function's arguments, not the wrapper.
 */
function getDisplayArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (isMAFApproval(name, args)) {
    const request = args.request as Record<string, unknown>;
    return (request.function_arguments as Record<string, unknown>) ?? {};
  }
  return args;
}

/**
 * Extracts the human-readable message from MAF approval requests.
 */
function getApprovalMessage(
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  if (isMAFApproval(name, args)) {
    const request = args.request as Record<string, unknown>;
    return request.message as string | undefined;
  }
  return undefined;
}

/**
 * Builds the proper response format.
 * For MAF: { approval_id, approved: boolean }
 * For generic: "approved" | "denied"
 */
export function buildApprovalResponse(
  name: string,
  args: Record<string, unknown>,
  decision: "approved" | "denied",
): unknown {
  if (isMAFApproval(name, args)) {
    const request = args.request as Record<string, unknown>;
    return {
      approval_id: request.approval_id,
      approved: decision === "approved",
    };
  }
  return decision;
}

export interface DefaultApprovalRendererProps {
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result: unknown;
  respond?: (result: unknown) => Promise<void>;
}

/**
 * A generic approve/deny UI for unregistered tool calls that require user confirmation.
 * Rendered automatically when `defaultApproval` is enabled on CopilotKitProvider and
 * a backend tool call arrives without a matching `useHumanInTheLoop` registration.
 *
 * Supports Microsoft Agent Framework's `ApprovalRequiredAIFunction` pattern:
 * - Detects `"request_approval"` tool calls and extracts the original function details
 * - Returns responses in MAF's expected format: `{ approval_id, approved: boolean }`
 * - Displays the human-readable `message` field when available
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

  // Determine if result indicates approval (works for both MAF and generic)
  // Result may be: "approved", '{"approval_id":"...","approved":true}', or an object
  const approved = isComplete && (() => {
    if (result === "approved") return true;
    if (typeof result === "object" && result !== null) {
      return (result as Record<string, unknown>).approved === true;
    }
    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        return parsed.approved === true;
      } catch {
        return false;
      }
    }
    return false;
  })();
  const denied = isComplete && !approved;

  const displayName = getDisplayName(name, args);
  const displayArgs = getDisplayArgs(name, args);
  const approvalMessage = getApprovalMessage(name, args);

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
          {approvalMessage ? (
            <div>
              <p className="cpk:text-sm cpk:text-zinc-700 cpk:dark:text-zinc-300">
                {approvalMessage}
              </p>
              <p className="cpk:mt-1 cpk:text-xs cpk:text-zinc-500 cpk:dark:text-zinc-400">
                Function:{" "}
                <span className="cpk:font-mono cpk:bg-zinc-100 cpk:dark:bg-zinc-800 cpk:px-1.5 cpk:py-0.5 cpk:rounded">
                  {displayName}
                </span>
              </p>
            </div>
          ) : (
            <p className="cpk:text-sm cpk:text-zinc-700 cpk:dark:text-zinc-300">
              The agent wants to execute{" "}
              <span className="cpk:font-mono cpk:text-xs cpk:bg-zinc-100 cpk:dark:bg-zinc-800 cpk:px-1.5 cpk:py-0.5 cpk:rounded">
                {displayName}
              </span>
            </p>
          )}
        </div>

        {/* Expandable arguments */}
        {displayArgs && Object.keys(displayArgs).length > 0 && (
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
                {JSON.stringify(displayArgs, null, 2)}
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
              onClick={() => respond(buildApprovalResponse(name, args, "approved"))}
            >
              Approve
            </button>
            <button
              type="button"
              className="cpk:flex-1 cpk:rounded-lg cpk:bg-red-600 cpk:px-3 cpk:py-2 cpk:text-sm cpk:font-medium cpk:text-white cpk:hover:bg-red-700 cpk:transition-colors"
              onClick={() => respond(buildApprovalResponse(name, args, "denied"))}
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
