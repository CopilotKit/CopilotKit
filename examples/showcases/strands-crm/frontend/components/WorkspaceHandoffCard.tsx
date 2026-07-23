"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Loader2 } from "lucide-react";

/**
 * Slim in-chat acknowledgment for tools whose output renders on the workspace.
 * While the tool runs it shows a one-line "working…" state; on completion it
 * fires `onShow` exactly once (to auto-navigate the workspace) and renders a
 * compact card with a "View" button that re-opens the page.
 */
export function WorkspaceHandoffCard({
  title,
  subtitle,
  status,
  pendingLabel = "Working…",
  viewLabel = "View",
  onShow,
  onView,
}: {
  title: string;
  subtitle?: string;
  status: string;
  pendingLabel?: string;
  viewLabel?: string;
  onShow?: () => void;
  onView?: () => void;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (status === "complete" && !shown.current) {
      shown.current = true;
      onShow?.();
    }
  }, [status, onShow]);

  if (status !== "complete") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {pendingLabel}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {onView && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 gap-1"
          onClick={onView}
        >
          {viewLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
