import type { DashboardWidget, SavedDashboard } from "@/types/dashboard";

const BASE = "/api/dashboards";
const LOCAL_KEY = "finance-erp-dashboards";

// ---------------------------------------------------------------------------
// localStorage helpers (fallback when no Postgres)
// ---------------------------------------------------------------------------

function getLocalCustom(): SavedDashboard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistLocal(dashboards: SavedDashboard[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(dashboards));
}

// ---------------------------------------------------------------------------
// Public API — merges server templates with local custom dashboards
// ---------------------------------------------------------------------------

export async function getSavedDashboards(): Promise<SavedDashboard[]> {
  try {
    const res = await fetch(BASE);
    if (!res.ok) return getLocalCustom();
    const serverDashboards: SavedDashboard[] = await res.json();

    // If server returned custom dashboards (Postgres is connected), use server data only
    const hasServerCustom = serverDashboards.some(
      (d) => d.category === "custom",
    );
    if (hasServerCustom) return serverDashboards;

    // Otherwise merge: server templates + localStorage custom
    const localCustom = getLocalCustom();
    return [...serverDashboards, ...localCustom];
  } catch {
    return getLocalCustom();
  }
}

export async function saveDashboard(
  name: string,
  widgets: DashboardWidget[],
  description?: string,
): Promise<SavedDashboard> {
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, widgets, description, category: "custom" }),
    });
    const entry: SavedDashboard = await res.json();

    // Also persist locally as fallback
    const local = getLocalCustom();
    local.push({ ...entry, category: "custom" });
    persistLocal(local);

    return entry;
  } catch {
    // Offline fallback
    const now = new Date().toISOString();
    const entry: SavedDashboard = {
      id: crypto.randomUUID(),
      name,
      description,
      category: "custom",
      widgets,
      createdAt: now,
      updatedAt: now,
    };
    const local = getLocalCustom();
    local.push(entry);
    persistLocal(local);
    return entry;
  }
}

export async function updateSavedDashboard(
  id: string,
  widgets: DashboardWidget[],
): Promise<SavedDashboard | null> {
  try {
    const res = await fetch(`${BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgets }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function deleteSavedDashboard(id: string): Promise<void> {
  try {
    await fetch(`${BASE}/${id}`, { method: "DELETE" });
  } catch {
    // ignore
  }
  // Also remove from localStorage
  const local = getLocalCustom().filter((d) => d.id !== id);
  persistLocal(local);
}

export async function loadSavedDashboard(
  id: string,
): Promise<DashboardWidget[] | null> {
  try {
    const res = await fetch(`${BASE}/${id}`);
    if (res.ok) {
      const data: SavedDashboard = await res.json();
      return data.widgets;
    }
  } catch {
    // fall through to local
  }
  // Check localStorage
  const local = getLocalCustom().find((d) => d.id === id);
  return local?.widgets ?? null;
}

export async function findSavedDashboardByName(
  name: string,
): Promise<SavedDashboard | null> {
  const dashboards = await getSavedDashboards();
  const lower = name.toLowerCase();
  return dashboards.find((d) => d.name.toLowerCase().includes(lower)) ?? null;
}
