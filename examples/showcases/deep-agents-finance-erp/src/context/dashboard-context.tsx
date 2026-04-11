"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import type { DashboardWidget, SavedDashboard } from "@/types/dashboard";
import {
  getSavedDashboards,
  saveDashboard as saveDashboardApi,
  deleteSavedDashboard,
  loadSavedDashboard,
  findSavedDashboardByName,
} from "@/lib/saved-dashboards";

const DEFAULT_WIDGETS: DashboardWidget[] = [
  {
    id: "kpi-cards",
    type: "kpi-cards",
    colSpan: 4,
    order: 0,
    config: {},
  },
  {
    id: "revenue-chart",
    type: "revenue-chart",
    colSpan: 3,
    order: 1,
    config: { showProfit: true, showExpenses: true },
  },
  {
    id: "expense-breakdown",
    type: "expense-breakdown",
    colSpan: 1,
    order: 2,
    config: {},
  },
  {
    id: "recent-transactions",
    type: "recent-transactions",
    colSpan: 2,
    order: 3,
    config: { limit: 5 },
  },
  {
    id: "outstanding-invoices",
    type: "outstanding-invoices",
    colSpan: 2,
    order: 4,
    config: { statuses: ["pending", "overdue"] },
  },
];

interface DashboardContextValue {
  widgets: DashboardWidget[];
  getWidgets: () => DashboardWidget[];
  addWidget: (widget: DashboardWidget) => void;
  removeWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
  upsertWidget: (
    type: DashboardWidget["type"],
    create: (order: number) => DashboardWidget,
    updates: Partial<DashboardWidget>,
  ) => { existed: boolean; id: string };
  setWidgets: (widgets: DashboardWidget[]) => void;
  resetToDefault: () => void;
  // Save/load
  savedDashboards: SavedDashboard[];
  currentDashboardName: string | null;
  saveCurrent: (name: string) => Promise<SavedDashboard>;
  loadSaved: (id: string) => Promise<boolean>;
  loadSavedByName: (name: string) => Promise<boolean>;
  deleteSaved: (id: string) => Promise<void>;
  refreshSaved: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [widgets, setWidgetsState] =
    useState<DashboardWidget[]>(DEFAULT_WIDGETS);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const [savedDashboards, setSavedDashboards] = useState<SavedDashboard[]>([]);
  const [currentDashboardName, setCurrentDashboardName] = useState<
    string | null
  >(null);

  // Load saved dashboards from API on mount
  useEffect(() => {
    getSavedDashboards().then(setSavedDashboards);
  }, []);

  const refreshSaved = useCallback(async () => {
    const dashboards = await getSavedDashboards();
    setSavedDashboards(dashboards);
  }, []);

  const getWidgets = useCallback(() => widgetsRef.current, []);

  const addWidget = useCallback((widget: DashboardWidget) => {
    setWidgetsState((prev) => [...prev, widget]);
    setCurrentDashboardName(null);
  }, []);

  const removeWidget = useCallback((widgetId: string) => {
    setWidgetsState((prev) => prev.filter((w) => w.id !== widgetId));
    setCurrentDashboardName(null);
  }, []);

  const updateWidget = useCallback(
    (widgetId: string, updates: Partial<DashboardWidget>) => {
      setWidgetsState((prev) =>
        prev.map((w) =>
          w.id === widgetId ? ({ ...w, ...updates } as DashboardWidget) : w,
        ),
      );
    },
    [],
  );

  const upsertWidget = useCallback(
    (
      type: DashboardWidget["type"],
      create: (order: number) => DashboardWidget,
      updates: Partial<DashboardWidget>,
    ) => {
      const current = widgetsRef.current;
      const existing = current.find((w) => w.type === type);
      if (existing) {
        setWidgetsState((prev) =>
          prev.map((w) =>
            w.id === existing.id
              ? ({ ...w, ...updates } as DashboardWidget)
              : w,
          ),
        );
        return { existed: true, id: existing.id };
      }
      const widget = create(current.length);
      setWidgetsState((prev) => [...prev, widget]);
      return { existed: false, id: widget.id };
    },
    [],
  );

  const setWidgets = useCallback((newWidgets: DashboardWidget[]) => {
    setWidgetsState(newWidgets);
    setCurrentDashboardName(null);
  }, []);

  const resetToDefault = useCallback(() => {
    setWidgetsState(DEFAULT_WIDGETS);
    setCurrentDashboardName(null);
  }, []);

  const saveCurrent = useCallback(
    async (name: string) => {
      const entry = await saveDashboardApi(name, widgetsRef.current);
      await refreshSaved();
      setCurrentDashboardName(name);
      return entry;
    },
    [refreshSaved],
  );

  const loadSaved = useCallback(async (id: string) => {
    const loadedWidgets = await loadSavedDashboard(id);
    if (!loadedWidgets) return false;
    setWidgetsState(loadedWidgets);
    const dashboards = await getSavedDashboards();
    const dashboard = dashboards.find((d) => d.id === id);
    setCurrentDashboardName(dashboard?.name ?? null);
    return true;
  }, []);

  const loadSavedByName = useCallback(async (name: string) => {
    const dashboard = await findSavedDashboardByName(name);
    if (!dashboard) return false;
    setWidgetsState(dashboard.widgets);
    setCurrentDashboardName(dashboard.name);
    return true;
  }, []);

  const deleteSaved = useCallback(
    async (id: string) => {
      await deleteSavedDashboard(id);
      await refreshSaved();
    },
    [refreshSaved],
  );

  return (
    <DashboardContext.Provider
      value={{
        widgets,
        getWidgets,
        addWidget,
        removeWidget,
        updateWidget,
        upsertWidget,
        setWidgets,
        resetToDefault,
        savedDashboards,
        currentDashboardName,
        saveCurrent,
        loadSaved,
        loadSavedByName,
        deleteSaved,
        refreshSaved,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return ctx;
}
