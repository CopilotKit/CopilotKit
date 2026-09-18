import { createHash } from "node:crypto";
import { PbHttpError } from "../storage/pb-client.js";
import type { PbClient } from "../storage/pb-client.js";
import type {
  ProbeResult,
  StatusRecord,
  WriteOutcome,
} from "../types/index.js";
import type { OverlayWrite, OverlayWriteOutcome } from "./status-writer.js";

export type SelectedOutcome =
  | { kind: "write"; value: WriteOutcome }
  | { kind: "overlay"; value: OverlayWriteOutcome };

export interface SelectedObservation {
  jobId: string;
  result: ProbeResult;
  /** Attempt the overlay first, then the error-state result on a genuine miss. */
  overlay?: OverlayWrite;
}

export interface ObservationReceipt {
  fingerprint: string;
  route: "write" | "overlay" | "history";
  outcome: SelectedOutcome;
}

export interface ObservationApplyRequest {
  jobId: string;
  key: string;
  fingerprint: string;
  route: ObservationReceipt["route"];
  basis: {
    id: string;
    fields: Record<string, unknown>;
    updated?: string;
  } | null;
  status: { mode: "upsert" | "patch"; values: Record<string, unknown> } | null;
  history: Record<string, unknown>;
  outcome: SelectedOutcome;
}

export interface ObservationApplyResponse {
  replay: boolean;
  outcome: SelectedOutcome;
}

export interface AtomicObservation {
  commit(
    existing: StatusRecord | null,
    status: ObservationApplyRequest["status"],
    history: object,
    outcome: SelectedOutcome,
  ): Promise<boolean>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function selectedObservationFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function basisFor(
  existing: StatusRecord | null,
): ObservationApplyRequest["basis"] {
  if (!existing) return null;
  if (!existing.id)
    throw new Error("selected observation: status row has no id");
  return {
    id: existing.id,
    fields: {
      key: existing.key,
      dimension: existing.dimension,
      state: existing.state,
      signal: existing.signal ?? null,
      observed_at: existing.observed_at,
      transitioned_at: existing.transitioned_at,
      fail_count: existing.fail_count ?? 0,
      first_failure_at: existing.first_failure_at ?? "",
      written_by: existing.written_by ?? "",
      state_written_at: existing.state_written_at ?? "",
    },
  };
}

function basisConflict(err: unknown): boolean {
  if (!(err instanceof PbHttpError) || err.statusCode !== 409) return false;
  try {
    const body: unknown = JSON.parse(err.bodyText);
    return (
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      body.data !== null &&
      typeof body.data === "object" &&
      "code" in body.data &&
      body.data.code === "basis_conflict"
    );
  } catch {
    return false;
  }
}

/** Runs the existing writer calculation against a receipt-guarded atomic commit. */
export async function persistSelectedObservation(
  pb: PbClient,
  input: SelectedObservation,
  calculate: (atomic: AtomicObservation) => Promise<SelectedOutcome>,
): Promise<SelectedOutcome> {
  if (!pb.applyFleetObservation) {
    throw new Error(
      "selected observation: atomic PocketBase client is required",
    );
  }
  const fingerprint = selectedObservationFingerprint({
    result: input.result,
    overlay: input.overlay,
  });
  const job = await pb.getOne<{
    result_observation_receipts?: Record<string, ObservationReceipt> | null;
  }>("probe_jobs", input.jobId);
  if (!job)
    throw new Error("selected observation: authoritative job is missing");
  if (!("result_observation_receipts" in job)) {
    throw new Error(
      "selected observation: PocketBase receipt migration is required",
    );
  }
  const receipt = job.result_observation_receipts?.[input.result.key];
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) {
      throw new Error("selected observation: identity_conflict");
    }
    return receipt.outcome;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let replayOutcome: SelectedOutcome | undefined;
      const calculated = await calculate({
        async commit(existing, status, history, outcome) {
          const response = await pb.applyFleetObservation!({
            jobId: input.jobId,
            key: input.result.key,
            fingerprint,
            route:
              outcome.kind === "overlay"
                ? "overlay"
                : status
                  ? "write"
                  : "history",
            basis: basisFor(existing),
            status,
            history: { ...history },
            outcome,
          });
          if (response.replay) replayOutcome = response.outcome;
          return !response.replay;
        },
      });
      return replayOutcome ?? calculated;
    } catch (err) {
      if (!basisConflict(err) || attempt === 2) throw err;
    }
  }
  throw new Error("selected observation: contention retries exhausted");
}
