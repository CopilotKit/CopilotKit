"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMPATIBILITY_SNAPSHOT } from "@/lib/compatibility";
import type { CompatibilitySnapshot } from "@/lib/compatibility";

interface SavedResponse {
  snapshot: CompatibilitySnapshot | null;
  lastAttemptStatus: "success" | "failed" | null;
  runUrl: string | null;
}

/** Reads saved results only. Collection is never started by a page load or poll. */
export function useCompatibilitySnapshot() {
  const [snapshot, setSnapshot] = useState<CompatibilitySnapshot>(
    COMPATIBILITY_SNAPSHOT,
  );
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(false);
  const [lastAttemptStatus, setLastAttemptStatus] =
    useState<SavedResponse["lastAttemptStatus"]>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await fetch("/api/ops/compatibility", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Saved results unavailable");
      const result: SavedResponse = await response.json();
      if (request !== sequence.current) return;
      if (result.snapshot !== null) {
        if (
          !result.snapshot ||
          !Array.isArray(result.snapshot.rows) ||
          typeof result.snapshot.date !== "string" ||
          !Number.isFinite(Date.parse(result.snapshot.assessedAt))
        )
          throw new Error("Invalid saved results");
        setSnapshot(result.snapshot);
        setSaved(true);
      }
      setLastAttemptStatus(result.lastAttemptStatus ?? null);
      setRunUrl(
        result.runUrl && /^https?:\/\//.test(result.runUrl)
          ? result.runUrl
          : null,
      );
      setReadError(false);
    } catch {
      if (request === sequence.current) setReadError(true);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const invalidateRequests = () => {
      ++sequence.current;
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      clearInterval(timer);
      invalidateRequests();
    };
  }, [refresh]);
  return {
    snapshot,
    saved,
    loading,
    readError,
    lastAttemptStatus,
    runUrl,
    refresh,
  };
}
