"use client";
/**
 * StatusTab — composes the probe schedule table and the currently-running
 * panel. Owns no data of its own; the parent passes in `entries` and a
 * trigger callback.
 *
 * TODO(B4b integration): once `lib/ops-api.ts` lands, replace the local
 * `ProbeScheduleEntry` interface below with the canonical export from
 * that module, and have page.tsx wire the `useProbes()` hook.
 */
import { useState } from "react";
import { StatusTable } from "./status-table";
import { StatusRunningPanel } from "./status-running-panel";
import { StatusDetailPanel } from "./status-detail-panel";

// TODO(B4b integration): replace with import from lib/ops-api
export interface ProbeScheduleEntry {
  id: string;
  kind: string;
  schedule: string; // cron expression
  nextRunAt: string | null; // ISO
  lastRun: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    state: "completed" | "failed";
    summary: { total: number; passed: number; failed: number };
  } | null;
  inflight: {
    startedAt: string;
    elapsedMs: number;
    services: Array<{
      slug: string;
      state: "queued" | "running" | "completed" | "failed";
      startedAt?: string;
      result?: "green" | "yellow" | "red";
    }>;
  } | null;
  config: {
    timeout_ms: number;
    max_concurrency: number;
    discovery: unknown;
  };
}

export interface StatusTabProps {
  entries: ProbeScheduleEntry[];
  onTrigger: (probeId: string, slugs?: string[]) => Promise<void>;
}

export function StatusTab({ entries, onTrigger }: StatusTabProps) {
  // Drilldown selection lives at the StatusTab level so the table and the
  // detail panel can stay decoupled — table emits an id, panel consumes it.
  const [selectedProbeId, setSelectedProbeId] = useState<string | null>(null);
  return (
    <div data-testid="status-tab" className="flex flex-col">
      <StatusTable
        entries={entries}
        onTrigger={onTrigger}
        onSelect={setSelectedProbeId}
      />
      <StatusRunningPanel entries={entries} />
      <StatusDetailPanel
        probeId={selectedProbeId}
        onClose={() => setSelectedProbeId(null)}
      />
    </div>
  );
}
