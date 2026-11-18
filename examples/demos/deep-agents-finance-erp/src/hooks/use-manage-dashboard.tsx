"use client";

import { useEffect } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";

interface ReorderUpdate {
  widgetId: string;
  colSpan?: number;
  order?: number;
}

// Module-level dedup set — survives component remounts (issue #04)
const processedKeys = new Set<string>();

function DashboardManager({
  action,
  widgetId,
  updates,
  status,
  result,
}: {
  action: string;
  widgetId?: string;
  updates?: ReorderUpdate[];
  status: string;
  result?: unknown;
}) {
  const { getWidgets, setWidgets, removeWidget, resetToDefault } =
    useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;

    const key = `manage_dashboard-${action}-${widgetId || ""}-${JSON.stringify(updates || [])}`;
    if (processedKeys.has(key)) return;
    processedKeys.add(key);

    queueMicrotask(() => {
      if (action === "reset") {
        resetToDefault();
      } else if (action === "remove" && widgetId) {
        removeWidget(widgetId);
      } else if (action === "reorder" && updates) {
        const updatedWidgets = getWidgets().map((w) => {
          const update = updates.find((u) => u.widgetId === w.id);
          if (!update) return w;
          return {
            ...w,
            ...(update.colSpan !== undefined && {
              colSpan: update.colSpan as 1 | 2 | 3 | 4,
            }),
            ...(update.order !== undefined && { order: update.order }),
          } as typeof w;
        });
        setWidgets(updatedWidgets);
      }
    });
  }, [
    status,
    action,
    widgetId,
    updates,
    resetToDefault,
    removeWidget,
    getWidgets,
    setWidgets,
  ]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="manage_dashboard"
        args={{ action, widgetId, updates }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Updating layout...
    </p>
  );
}

export function useManageDashboard() {
  useRenderTool(
    {
      name: "manage_dashboard",
      render: ({ args, status, result }) => (
        <DashboardManager
          action={args?.action ?? ""}
          widgetId={args?.widgetId}
          updates={args?.updates}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
}
