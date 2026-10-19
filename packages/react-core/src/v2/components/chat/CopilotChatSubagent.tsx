import React, { createContext, useId, useState } from "react";
import type { Message } from "@ag-ui/core";
import type {
  Subagent,
  SubagentStatus,
  ɵSubagentGroup,
  ɵSubagentLayout,
} from "@copilotkit/core";
import { ChevronRight } from "lucide-react";
import { twMerge } from "tailwind-merge";

export type CopilotChatSubagentProps = {
  /** The invocation this group shows. */
  subagentRunId: string;
  /**
   * What the agent announced about the invocation. Undefined when the agent
   * attributed messages to it without announcing it.
   */
  subagent?: Subagent;
  /** The subagent's own messages, in order. */
  messages: Message[];
  /** The rendered messages, and any nested subagent groups. */
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">;

/**
 * @internal What the message view hands down so tool-call views deep in the
 * tree can render the groups anchored to their tool calls.
 */
export interface SubagentLayoutContextValue {
  layout: ɵSubagentLayout;
  renderGroup: (group: ɵSubagentGroup) => React.ReactElement;
}

/** @internal */
export const SubagentLayoutContext =
  createContext<SubagentLayoutContextValue | null>(null);

const statusLabel: Record<SubagentStatus, string> = {
  running: "Running",
  done: "Done",
  suspended: "Waiting",
  error: "Failed",
};

const statusClassName: Record<SubagentStatus, string> = {
  running:
    "cpk:bg-amber-100 cpk:text-amber-800 cpk:dark:bg-amber-500/15 cpk:dark:text-amber-400",
  done: "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400",
  suspended:
    "cpk:bg-sky-100 cpk:text-sky-800 cpk:dark:bg-sky-500/15 cpk:dark:text-sky-400",
  error:
    "cpk:bg-red-100 cpk:text-red-800 cpk:dark:bg-red-500/15 cpk:dark:text-red-400",
};

/**
 * The default group for one subagent's work in the chat. It starts collapsed
 * to its header, which shows the name and the status, so a streaming subagent
 * does not push the chat around. A click on the header opens or closes it.
 *
 * Replace it with the `subagent` slot on `CopilotChatMessageView`:
 * `<CopilotChat messageView={{ subagent: MyGroup }} />`.
 */
export function CopilotChatSubagent({
  subagentRunId,
  subagent,
  messages: _messages,
  children,
  className,
  ...props
}: CopilotChatSubagentProps) {
  const status = subagent?.status;
  const [isOpen, setIsOpen] = useState(false);
  const bodyId = useId();

  return (
    <div
      data-copilotkit
      data-subagent-run-id={subagentRunId}
      data-status={status}
      className={twMerge(
        "cpk:my-2 cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:px-3 cpk:py-2 cpk:dark:border-zinc-800/60",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => setIsOpen((open) => !open)}
        className="cpk:flex cpk:w-full cpk:cursor-pointer cpk:select-none cpk:items-center cpk:gap-2 cpk:border-none cpk:bg-transparent cpk:p-0 cpk:text-left cpk:text-sm"
      >
        <ChevronRight
          aria-hidden="true"
          className={twMerge(
            "cpk:size-3.5 cpk:shrink-0 cpk:text-muted-foreground cpk:transition-transform cpk:duration-200",
            isOpen && "cpk:rotate-90",
          )}
        />
        <span className="cpk:truncate cpk:font-medium">
          {subagent?.name ?? "Subagent"}
        </span>
        {status && (
          <span
            className={twMerge(
              "cpk:inline-flex cpk:shrink-0 cpk:items-center cpk:rounded-full cpk:px-2 cpk:py-0.5 cpk:text-[11px] cpk:font-medium",
              statusClassName[status],
            )}
          >
            {statusLabel[status]}
          </span>
        )}
        {subagent?.description && (
          <span className="cpk:truncate cpk:text-muted-foreground">
            {subagent.description}
          </span>
        )}
      </button>
      <div id={bodyId} hidden={!isOpen} className="cpk:mt-2">
        {subagent?.error && (
          <p className="cpk:text-sm cpk:text-red-700 cpk:dark:text-red-400">
            {subagent.error.message}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

export default CopilotChatSubagent;
