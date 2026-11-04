import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/status";

/** One slim line in the agent's activity trail. */
export function ActivityRow({
  icon,
  title,
  detail,
  meta,
  running,
  tone = "default",
  children,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  meta?: ReactNode;
  running?: boolean;
  tone?: "default" | "pass" | "fail";
  children?: ReactNode;
}) {
  return (
    <div
      className="enter w-full"
      data-testid="activity-row"
      data-chat-block={children ? "card" : "row"}
    >
      <div className="flex min-h-[38px] items-center gap-3 text-[15.5px]">
        <span
          className={cn(
            "flex size-8 flex-none items-center justify-center rounded-lg border border-line bg-panel",
            tone === "pass" && "text-pass",
            tone === "fail" && "text-fail",
            tone === "default" && "text-dim",
          )}
        >
          {running ? <Spinner className="size-4 text-accent" /> : icon}
        </span>
        <span className="flex-none text-text/90">{title}</span>
        {detail && (
          <span className="min-w-0 truncate font-mono text-[14px] text-dim">
            {detail}
          </span>
        )}
        {meta && (
          <span className="ml-auto flex-none pl-2 text-[14px] text-faint">
            {meta}
          </span>
        )}
      </div>
      {/* Cards under a row share the column's left edge and width with every other card. */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
