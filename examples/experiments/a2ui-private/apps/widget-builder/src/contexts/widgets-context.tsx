'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Widget } from '@/types/widget';
import { getWidgets, saveWidget, deleteWidget } from '@/lib/storage';

// Module-level cache - persists outside React tree
let cachedWidgets: Widget[] | null = null;
let initPromise: Promise<void> | null = null;

async function initializeStore(
  setWidgets: (w: Widget[]) => void,
  setLoading: (l: boolean) => void
) {
  // If already cached, use immediately
  if (cachedWidgets !== null) {
    setWidgets(cachedWidgets);
    setLoading(false);
    return;
  }

  // If fetch in progress, wait for it
  if (initPromise) {
    await initPromise;
    if (cachedWidgets) {
      setWidgets(cachedWidgets);
      setLoading(false);
    }
    return;
  }

  // First time - fetch and cache
  initPromise = getWidgets().then(w => {
    cachedWidgets = w;
  });
  await initPromise;
  setWidgets(cachedWidgets!);
  setLoading(false);
}

interface WidgetsContextType {
  widgets: Widget[];
  loading: boolean;
  addWidget: (widget: Widget) => Promise<void>;
  updateWidget: (id: string, updates: Partial<Widget>) => Promise<void>;
  removeWidget: (id: string) => Promise<void>;
  getWidget: (id: string) => Widget | undefined;
}

const WidgetsContext = createContext<WidgetsContextType | null>(null);

export function WidgetsProvider({ children }: { children: ReactNode }) {
  // Initialize from cache if available
  const [widgets, setWidgets] = useState<Widget[]>(cachedWidgets ?? []);
  const [loading, setLoading] = useState(cachedWidgets === null);

  useEffect(() => {
    initializeStore(setWidgets, setLoading);
  }, []);

  const addWidget = useCallback(async (widget: Widget) => {
    await saveWidget(widget);
    setWidgets(prev => {
      const updated = [...prev, widget];
      cachedWidgets = updated;
      return updated;
    });
  }, []);

  const updateWidget = useCallback(async (id: string, updates: Partial<Widget>) => {
    setWidgets(prev => {
      const widget = prev.find(w => w.id === id);
      if (widget) {
        const updated = { ...widget, ...updates, updatedAt: new Date() };
        saveWidget(updated);
        const newWidgets = prev.map(w => w.id === id ? updated : w);
        cachedWidgets = newWidgets;
        return newWidgets;
      }
      return prev;
    });
  }, []);

  const removeWidget = useCallback(async (id: string) => {
    await deleteWidget(id);
    setWidgets(prev => {
      const updated = prev.filter(w => w.id !== id);
      cachedWidgets = updated;
      return updated;
    });
  }, []);

  const getWidget = useCallback((id: string) => {
    return widgets.find(w => w.id === id);
  }, [widgets]);

  return (
    <WidgetsContext.Provider value={{ widgets, loading, addWidget, updateWidget, removeWidget, getWidget }}>
      {children}
    </WidgetsContext.Provider>
  );
}

export function useWidgets() {
  const context = useContext(WidgetsContext);
  if (!context) {
    throw new Error('useWidgets must be used within a WidgetsProvider');
  }
  return context;
}
