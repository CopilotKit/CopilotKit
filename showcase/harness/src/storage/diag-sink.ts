/**
 * diag-sink.ts — DURABLE, HTTP-readable persistence for CVDIAG diagnostic
 * events.
 *
 * WHY this collection exists (and is NOT just stdout logging): the
 * CV-propagation incident is diagnosed MID-INCIDENT, and Railway's stdout log
 * window is capped and rolls off — by the time an operator queries, the
 * `grep CVDIAG` trail may already be gone. Persisting each CVDIAG event as a
 * row in the `diag_events` PocketBase collection (see
 * pb_migrations/1779990100_create_diag_events.js) makes the propagation chain
 * pullable over plain HTTP (the collection is anonymously LIST/VIEW readable,
 * mirroring `resource_snapshots`) while the incident is still live.
 *
 * BEST-EFFORT GUARANTEE: the write is pure instrumentation — it must NEVER
 * throw into the boundary it observes. A missing migration, a PB hiccup, a 400
 * from an unrun migration, or any network error is SWALLOWED and surfaced as a
 * single `CVDIAG`-tagged `console.warn` line (so the failure itself is
 * greppable from the same anchor as the events). This mirrors the hard
 * best-effort contract `resource-snapshot-writer.ts` learned from a prior
 * incident where a state write that needed an unrun migration 400'd and broke
 * the caller.
 */

import type { PbClient } from "./pb-client.js";

/** Collection name — mirrors the PB migration. */
export const DIAG_EVENTS_COLLECTION = "diag_events";

/**
 * Minimal PB surface this sink needs — a structural subset of the harness
 * `PbClient` so the real client satisfies it and tests can pass a tiny fake.
 */
export interface DiagSinkPbClient {
  create<T>(collection: string, record: Record<string, unknown>): Promise<T>;
}

/** The `PbClient` interface already satisfies `DiagSinkPbClient`. */
export type DiagSinkClient = Pick<PbClient, "create">;

/**
 * One persisted CVDIAG event. Field names match the `diag_events` PB schema
 * 1:1 so the record is written through verbatim. All fields beyond `run_id`
 * are optional at the type level — the boundary owner fills what it has, and a
 * MISSING header is the load-bearing signal (`header_present=false`).
 */
export interface DiagEventRecord {
  run_id: string;
  slug?: string;
  framework?: string;
  component?: string;
  boundary?: string;
  header_present?: boolean;
  status?: string;
  hops?: string;
  test_id?: string;
  error?: string;
}

/**
 * Persist one CVDIAG event row, best-effort. Resolves whether the write
 * succeeded or was swallowed; NEVER rejects. On failure it emits a single
 * `CVDIAG`-tagged `console.warn` so the drop is greppable alongside the events
 * it was meant to record.
 */
export async function writeDiagEvent(
  pb: DiagSinkClient,
  record: DiagEventRecord,
): Promise<void> {
  try {
    await pb.create(DIAG_EVENTS_COLLECTION, { ...record });
  } catch (err) {
    // Pure instrumentation: degrade silently into stdout, never break the
    // boundary that called us. Tag with CVDIAG so this drop shows up in the
    // same grep as the events it failed to persist; redact nothing here
    // beyond what the record already carries (callers go through
    // `formatCvdiag` upstream for the line itself).
    console.warn(
      `CVDIAG diag-sink write failed run_id=${record.run_id ?? "none"} ` +
        `boundary=${record.boundary ?? "-"} error=${String(err)}`,
    );
  }
}
