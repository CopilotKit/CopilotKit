"use client";

import { useEffect, useState } from "react";

/**
 * The thread rail shows only conversations since the last full demo reset
 * (`POST /api/learning/v1/reset`, or Reset in the sidebar). Without
 * Intelligence the runtime cannot delete threads, so each rehearsal would
 * otherwise pile up in the rail. The reset time rides on `/ledger/version`.
 */
export function useThreadsHiddenBefore(): number | null {
  const [resetAt, setResetAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const res = await fetch("/api/ledgerline/v1/ledger/version", {
          cache: "no-store",
        });
        const body = (await res.json()) as { resetAt?: number | null };
        if (alive)
          setResetAt(typeof body.resetAt === "number" ? body.resetAt : null);
      } catch {
        // Show every thread rather than guess.
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return resetAt;
}
