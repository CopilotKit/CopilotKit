"use client";

import { KanbanSquare, BarChart3, List, RefreshCw, RotateCcw } from "lucide-react";
import type { ViewMode, SyncMeta } from "@/lib/leads/types";

const VIEWS: { id: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare },
  { id: "demand", label: "Demand", icon: BarChart3 },
  { id: "list", label: "List", icon: List },
];

interface HeaderProps {
  title: string;
  subtitle: string;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  totalLeads: number;
  visibleLeads: number;
  sync: SyncMeta;
  /**
   * Wipe the local lead store back to its committed seed.
   * The button is only rendered when `sync.databaseTitle` indicates the
   * local store is active (string starts with "Local:"). Should DELETE
   * /api/leads/reset and trigger a re-import — `page.tsx` owns the
   * actual fetch + injectPrompt so the Header stays presentational.
   */
  onResetLocalData?: () => void | Promise<void>;
}

export function Header({
  title,
  subtitle,
  view,
  onViewChange,
  totalLeads,
  visibleLeads,
  sync,
  onResetLocalData,
}: HeaderProps) {
  const isLocalMode = sync.databaseTitle?.startsWith("Local:") ?? false;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">{visibleLeads}</span>
            {visibleLeads !== totalLeads ? (
              <> of {totalLeads}</>
            ) : null}{" "}
            leads
          </span>
          {sync.databaseTitle ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-muted-foreground/50" />
              <span>{isLocalMode ? sync.databaseTitle : `Notion: ${sync.databaseTitle}`}</span>
            </span>
          ) : null}
          {sync.syncedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="size-3" />
              {formatRelative(sync.syncedAt)}
            </span>
          ) : null}
          {isLocalMode && onResetLocalData ? (
            <button
              type="button"
              onClick={() => {
                void onResetLocalData();
              }}
              className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
              title="Wipe agent/data/leads.local.json back to the bundled seed"
            >
              <RotateCcw className="size-2.5" />
              Reset local data
            </button>
          ) : null}
        </div>
      </div>
      <div className="inline-flex shrink-0 rounded-md border border-border bg-card p-0.5">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onViewChange(v.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {v.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

function formatRelative(iso: string): string {
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return "synced";
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "synced";
  }
}
