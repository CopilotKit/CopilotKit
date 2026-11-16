"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cleanOutput } from "@/lib/command-output";
import { cn } from "@/lib/cn";

const TAIL_LINES = 8;

/**
 * A command's output: the last lines by default, the rest one click away.
 * With `hidden`, even the tail waits behind a "Show output" button.
 */
export function CommandOutput({
  output,
  hidden = false,
}: {
  output: string;
  hidden?: boolean;
}) {
  const lines = useMemo(() => cleanOutput(output), [output]);
  const [open, setOpen] = useState(!hidden);
  const [full, setFull] = useState(false);
  if (lines.length === 0) return null;

  const count = `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[14px] text-dim hover:text-text"
      >
        <ChevronDown className="size-4" aria-hidden />
        Show output ({count})
      </button>
    );
  }

  const clipped = !full && lines.length > TAIL_LINES;
  const shown = clipped ? lines.slice(-TAIL_LINES) : lines;
  return (
    <div
      className="overflow-hidden rounded-lg border border-line bg-bg/70"
      data-testid="command-output"
    >
      {clipped && (
        <p className="border-b border-line px-3 py-1.5 text-[14px] text-faint">
          Last {TAIL_LINES} of {count}
        </p>
      )}
      <pre
        className={cn(
          "wrap-code scroll-thin overflow-y-auto px-3 py-2 font-mono text-[14px] leading-relaxed text-dim",
          full && "max-h-[420px]",
        )}
      >
        {shown.join("\n")}
      </pre>
      {(lines.length > TAIL_LINES || hidden) && (
        <div className="flex items-center gap-4 border-t border-line px-3 py-1.5">
          {lines.length > TAIL_LINES && (
            <button
              type="button"
              onClick={() => setFull((value) => !value)}
              className="text-[14px] font-medium text-dim hover:text-text"
            >
              {full ? "Show last lines" : `Show full output (${count})`}
            </button>
          )}
          {hidden && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFull(false);
              }}
              className="text-[14px] text-faint hover:text-text"
            >
              Hide output
            </button>
          )}
        </div>
      )}
    </div>
  );
}
