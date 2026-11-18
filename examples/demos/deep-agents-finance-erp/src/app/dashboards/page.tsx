"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardMiniPreview } from "@/components/dashboard/dashboard-mini-preview";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { colSpanClass } from "@/components/dashboard/widget-renderer";
import { useDashboard } from "@/context/dashboard-context";
import type { SavedDashboard } from "@/types/dashboard";
import {
  ArrowLeft,
  Play,
  Trash2,
  Copy,
  LayoutGrid,
  Clock,
  Layers,
} from "lucide-react";

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

function DashboardRow({
  dashboard,
  onClick,
  onLoad,
  onDelete,
  isActive,
  showDelete,
}: {
  dashboard: SavedDashboard;
  onClick: () => void;
  onLoad: () => void;
  onDelete?: () => void;
  isActive: boolean;
  showDelete: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative flex cursor-pointer items-center gap-5 rounded-xl border px-5 py-4 transition-all hover:border-foreground/20 hover:shadow-sm ${
        isActive
          ? "border-primary/40 bg-primary/[0.03]"
          : "border-border bg-card"
      }`}
    >
      {/* Mini preview */}
      <div className="hidden w-28 shrink-0 sm:block">
        <DashboardMiniPreview widgets={dashboard.widgets} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {dashboard.name}
          </h3>
          {isActive && (
            <Badge variant="default" className="text-[10px]">
              Active
            </Badge>
          )}
        </div>
        {dashboard.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {dashboard.description}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {dashboard.widgets.length} widgets
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(dashboard.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Button
          size="sm"
          variant={isActive ? "outline" : "default"}
          onClick={onLoad}
          disabled={isActive}
        >
          <Play className="h-3.5 w-3.5" />
          {isActive ? "Active" : "Load"}
        </Button>
        {showDelete && onDelete && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function DetailView({
  dashboard,
  onBack,
  onLoad,
  onDelete,
  onDuplicate,
  isActive,
}: {
  dashboard: SavedDashboard;
  onBack: () => void;
  onLoad: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  isActive: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All dashboards
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              {dashboard.name}
            </h2>
            {dashboard.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {dashboard.description}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Badge
                variant={
                  dashboard.category === "template" ? "secondary" : "outline"
                }
              >
                {dashboard.category === "template" ? "Template" : "Custom"}
              </Badge>
              {isActive && <Badge variant="default">Active</Badge>}
              <span className="text-xs text-muted-foreground self-center">
                {dashboard.widgets.length} widgets &middot; Updated{" "}
                {new Date(dashboard.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button size="sm" onClick={onLoad} disabled={isActive}>
              <Play className="h-3.5 w-3.5" />
              {isActive ? "Active" : "Load"}
            </Button>
            <Button size="sm" variant="outline" onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </Button>
            {dashboard.category !== "template" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onDelete}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Widget preview */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          Layout Preview
        </h3>
        <div className="pointer-events-none origin-top-left">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[...dashboard.widgets]
              .sort((a, b) => a.order - b.order)
              .map((widget) => (
                <div key={widget.id} className={colSpanClass(widget.colSpan)}>
                  <WidgetRenderer widget={widget} />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardsPage() {
  return (
    <Shell>
      <DashboardsContent />
    </Shell>
  );
}

function DashboardsContent() {
  const router = useRouter();
  const {
    setWidgets,
    currentDashboardName,
    savedDashboards,
    refreshSaved,
    deleteSaved,
    saveCurrent,
  } = useDashboard();

  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      await refreshSaved();
      setLoading(false);
    }
    void load();
  }, [refreshSaved]);

  // Use savedDashboards from context (kept in sync via refreshSaved)
  useEffect(() => {
    setDashboards(savedDashboards);
  }, [savedDashboards]);

  const selected = dashboards.find((d) => d.id === selectedId);

  const templates = dashboards.filter((d) => d.category === "template");
  const custom = dashboards.filter((d) => d.category === "custom");

  const handleLoad = (dashboard: SavedDashboard) => {
    setWidgets(dashboard.widgets);
    router.push("/");
  };

  const handleDelete = async (id: string) => {
    await deleteSaved(id);
    setSelectedId(null);
  };

  const handleDuplicate = async (dashboard: SavedDashboard) => {
    await saveCurrent(`${dashboard.name} (Copy)`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="animate-pulse text-muted-foreground">
          Loading dashboards...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <LayoutGrid className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
              Dashboard Gallery
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {selected
              ? "Dashboard details and preview."
              : "Browse templates and saved layouts."}
          </p>
        </div>

        {selected ? (
          <DetailView
            dashboard={selected}
            onBack={() => setSelectedId(null)}
            onLoad={() => handleLoad(selected)}
            onDelete={() => void handleDelete(selected.id)}
            onDuplicate={() => void handleDuplicate(selected)}
            isActive={currentDashboardName === selected.name}
          />
        ) : (
          <div className="space-y-8">
            {/* Templates */}
            {templates.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Templates
                </h2>
                <div className="space-y-2">
                  {templates.map((d) => (
                    <DashboardRow
                      key={d.id}
                      dashboard={d}
                      onClick={() => setSelectedId(d.id)}
                      onLoad={() => handleLoad(d)}
                      isActive={currentDashboardName === d.name}
                      showDelete={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Custom / saved */}
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                My Dashboards
              </h2>
              {custom.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-10">
                  <LayoutGrid className="mb-2 h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    No saved dashboards yet. Ask the AI to build one, then save
                    it.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {custom.map((d) => (
                    <DashboardRow
                      key={d.id}
                      dashboard={d}
                      onClick={() => setSelectedId(d.id)}
                      onLoad={() => handleLoad(d)}
                      onDelete={() => void handleDelete(d.id)}
                      isActive={currentDashboardName === d.name}
                      showDelete={true}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
