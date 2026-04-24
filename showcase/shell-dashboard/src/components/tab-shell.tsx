"use client";
/**
 * TabShell — tab bar + content panels.
 *
 * Active tab stored in URL hash (#cells, #parity, #packages) with
 * localStorage fallback. Tabs are mounted on first switch and kept
 * in the DOM to preserve SSE subscription state.
 */
import { useState, useEffect } from "react";

export interface TabDef {
  id: string;
  label: string;
  count?: string;
  content: React.ReactNode;
}

export interface TabShellProps {
  tabs: TabDef[];
  defaultTab: string;
}

function readInitialTab(tabs: TabDef[], defaultTab: string): string {
  // Priority: URL hash > localStorage > default
  if (typeof window !== "undefined") {
    const hash = window.location.hash.replace("#", "");
    if (hash && tabs.some((t) => t.id === hash)) return hash;
    try {
      const stored = localStorage.getItem("dashboard-active-tab");
      if (stored && tabs.some((t) => t.id === stored)) return stored;
    } catch {
      // Ignore
    }
  }
  return defaultTab;
}

export function TabShell({ tabs, defaultTab }: TabShellProps) {
  const [activeTab, setActiveTab] = useState(() =>
    readInitialTab(tabs, defaultTab),
  );
  // Track which tabs have been mounted at least once (keep in DOM).
  const [mounted, setMounted] = useState<Set<string>>(
    () => new Set([activeTab]),
  );

  const select = (id: string) => {
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setActiveTab(id);
  };

  useEffect(() => {
    // Persist active tab to URL hash and localStorage
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${activeTab}`);
      try {
        localStorage.setItem("dashboard-active-tab", activeTab);
      } catch {
        // Ignore
      }
    }
  }, [activeTab]);

  return (
    <div data-testid="tab-shell">
      <div className="flex items-center gap-0 border-b border-[var(--border)] px-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-${tab.id}`}
            onClick={() => select(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-[10px] tabular-nums text-[var(--text-muted)]">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div>
        {tabs.map((tab) => {
          const isMounted = mounted.has(tab.id);
          if (!isMounted) return null;
          return (
            <div
              key={tab.id}
              data-testid={`tab-panel-${tab.id}`}
              style={{ display: activeTab === tab.id ? "block" : "none" }}
            >
              {tab.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
