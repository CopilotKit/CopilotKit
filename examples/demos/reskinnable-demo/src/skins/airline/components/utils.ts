import type { Tier } from "../data/types";

export { cn } from "@/lib/utils";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function durationBetween(startIso: string, endIso: string): string {
  try {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  } catch {
    return "";
  }
}

export function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMin = Math.round((now - then) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay}d ago`;
  } catch {
    return iso;
  }
}

export type TierStyle = {
  label: string;
  bg: string;
  ring: string;
  gradient: string;
};

export const tierStyle: Record<Tier, TierStyle> = {
  bronze: {
    label: "Bronze",
    bg: "bg-amber-700 text-white",
    ring: "ring-amber-700/30",
    gradient: "from-amber-700 to-amber-900",
  },
  silver: {
    label: "Silver",
    bg: "bg-slate-400 text-white",
    ring: "ring-slate-400/30",
    gradient: "from-slate-400 to-slate-600",
  },
  gold: {
    label: "Gold",
    bg: "bg-yellow-500 text-white",
    ring: "ring-yellow-500/30",
    gradient: "from-yellow-400 via-amber-500 to-yellow-600",
  },
  platinum: {
    label: "Platinum",
    bg: "bg-indigo-600 text-white",
    ring: "ring-indigo-600/30",
    gradient: "from-indigo-500 via-purple-600 to-indigo-700",
  },
};

const FALLBACK_TIER: TierStyle = {
  label: "Member",
  bg: "bg-stone-500 text-white",
  ring: "ring-stone-500/30",
  gradient: "from-stone-500 to-stone-700",
};

/**
 * Safe enum lookup. Tool arguments arriving via streaming may have missing or
 * partial keys; this avoids `undefined.foo` crashes by returning the fallback
 * for any unknown key.
 */
export function lookup<T>(
  table: Record<string, T>,
  key: string | null | undefined,
  fallback: T,
): T {
  if (!key) return fallback;
  return table[key] ?? fallback;
}

export function tierStyleOf(tier: string | null | undefined): TierStyle {
  return lookup(tierStyle, tier, FALLBACK_TIER);
}
