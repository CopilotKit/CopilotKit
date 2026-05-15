"use client";
/**
 * StatusTab — composes the probe schedule table and the currently-running
 * panel. Owns no data of its own; the parent passes in `entries` and a
 * trigger callback.
 *
 * `ProbeScheduleEntry` is re-exported from `lib/ops-api` so existing
 * imports from `./status-tab` keep working while the canonical wire-shape
 * lives in one place. The canonical definition is the source of truth for
 * the showcase-harness HTTP contract — drift between this file and ops-api
 * was a real problem (e.g. local lacked `error?` / `finishedAt?` on
 * service progress, and used `string` instead of the `ProbeKind` union).
 */
import { StatusTable } from "./status-table";
import { StatusRunningPanel } from "./status-running-panel";
import { StatusDetailPanel } from "./status-detail-panel";

// Re-export the canonical type for backwards compatibility with existing
// `import type { ProbeScheduleEntry } from './status-tab'` call sites.
export type { ProbeScheduleEntry } from "../lib/ops-api";
import type { ProbeScheduleEntry } from "../lib/ops-api";

export interface StatusTabProps {
  entries: ProbeScheduleEntry[];
  onTrigger: (probeId: string, slugs?: string[]) => Promise<void>;
  selectedProbeId: string | null;
  onSelectProbe: (probeId: string | null) => void;
}

export function StatusTab({
  entries,
  onTrigger,
  selectedProbeId,
  onSelectProbe,
}: StatusTabProps) {
  return (
    <div data-testid="status-tab" className="flex flex-col">
      <StatusTable
        entries={entries}
        onTrigger={onTrigger}
        onSelect={(id) => onSelectProbe(id)}
      />
      <StatusRunningPanel entries={entries} />
      <StatusDetailPanel
        probeId={selectedProbeId}
        onClose={() => onSelectProbe(null)}
      />
    </div>
  );
}
