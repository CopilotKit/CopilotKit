import { useEffect, useMemo, useRef, useState } from "react";
import { isMemoryUpdateMessage, MemoryUpdateMessage } from "../types/memory";

export type RecentMemoryUpdate = MemoryUpdateMessage & { at: number; friendly: string };

function toFriendlyText(update: MemoryUpdateMessage): string {
  const rawKey = (update.fact_key || "").toString();
  const value = update.new_value;
  // Render exactly what the schema provides, no frontend mapping/formatting
  if (update.display_label || update.display_value) {
    const label = update.display_label ?? rawKey;
    const display =
      update.display_value ?? (typeof value === "string" ? value : JSON.stringify(value));
    return `${label}: ${display}`;
  }
  // Minimal fallback: raw key/value
  const display = typeof value === "string" ? value : JSON.stringify(value);
  return `${rawKey}: ${display}`;
}

export function useRecentMemoryUpdates(ttlMs: number = 5000) {
  const [updates, setUpdates] = useState<RecentMemoryUpdate[]>([]);
  const ttlRef = useRef(ttlMs);
  ttlRef.current = ttlMs;

  useEffect(() => {
    function onEvent(e: any) {
      const detail = e?.detail;
      if (!isMemoryUpdateMessage(detail)) return;
      const now = Date.now();
      const friendly = toFriendlyText(detail);
      setUpdates((prev) => [{ ...detail, at: now, friendly }, ...prev]);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("copilotkit:memory_update", onEvent as any);
    }
    let interval: any = null;
    if (ttlRef.current > 0) {
      interval = setInterval(
        () => {
          const now = Date.now();
          setUpdates((prev) => prev.filter((u) => now - u.at < ttlRef.current));
        },
        Math.min(1000, ttlRef.current),
      );
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("copilotkit:memory_update", onEvent as any);
      }
      if (interval) clearInterval(interval);
    };
  }, []);

  return useMemo(() => updates, [updates]);
}
