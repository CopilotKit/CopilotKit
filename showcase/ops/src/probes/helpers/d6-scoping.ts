/**
 * D6 — scoping + reference-snapshot loading helper.
 *
 * The D6 driver compares LIVE captures against on-disk reference snapshots
 * across the showcase fleet. Running EVERY (integration, featureType) pair
 * on every tick is intractable: ~17 integrations × ~10 feature types ×
 * (60-90s/cell × multiple turns) ≈ multiple wall-clock hours per run.
 *
 * Per the D5-D6 spec resolution (Notion 34c3aa38, Q3) the driver runs in
 * one of two modes:
 *
 *   - **weekly-rotation** — Monday-cron pick: `weekIndex % integrationCount`
 *     selects the single integration to compare for the week. All
 *     featureTypes for that integration run; the rest of the fleet sits
 *     out the tick. Coverage is round-robin: 17 integrations → ~17 weeks
 *     for full fleet coverage, which lines up with the spec's "weekly
 *     reference refresh" cadence.
 *
 *   - **on-demand** — operator picks an integration explicitly via env
 *     `D6_TARGET_INTEGRATION`. Bypasses cron, runs all featureTypes for
 *     that one integration, and is intended for ad-hoc triage (post-
 *     deploy, post-fixture-update, post-tolerance-recalibration).
 *
 * This module owns the scoping math + the on-disk reference loader so
 * the driver itself stays focused on browser orchestration and parity
 * verdict mapping. Pure logic + small filesystem reads — no Playwright,
 * no Railway, no PB.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { D5FeatureType } from "./d5-registry.js";
import type { ParitySnapshot } from "./parity-compare.js";

/** Scoping mode discriminator. */
export type D6Mode = "weekly-rotation" | "on-demand";

export interface D6ScopingEnv {
  /** Mode env var. Default `"weekly-rotation"` if absent. */
  D6_MODE?: string;
  /** Target integration slug for on-demand mode. Required iff mode === on-demand. */
  D6_TARGET_INTEGRATION?: string;
}

/**
 * Result of scoping: which integration slugs to run this tick.
 *
 * Weekly-rotation always returns at most one integration; on-demand
 * always returns exactly one. The list shape is kept identical so
 * callers don't have to branch on mode at the use site.
 */
export interface D6ScopingResult {
  mode: D6Mode;
  /** Selected integration slug(s). Empty when no integrations are wired. */
  selected: string[];
  /** Free-form reason — surfaced in driver logs / notes for operators. */
  reason: string;
}

/**
 * Resolve the D6 mode from env. Errors loud on a known-but-misspelled
 * mode (e.g. `"weekly_rotation"`); defaults to weekly-rotation when
 * absent.
 */
export function resolveD6Mode(env: D6ScopingEnv): D6Mode {
  const raw = env.D6_MODE;
  if (raw === undefined || raw === "") return "weekly-rotation";
  if (raw === "weekly-rotation" || raw === "on-demand") return raw;
  throw new Error(
    `D6_MODE must be "weekly-rotation" or "on-demand" (got "${raw}")`,
  );
}

/**
 * Compute the ISO week number (1-53) of the given date in UTC. Uses the
 * standard ISO-8601 algorithm: week 1 is the week containing the first
 * Thursday of the year. Stable across years — week N of year Y advances
 * to week N+1 each Monday at 00:00 UTC.
 *
 * Exported for direct use in tests; callers normally go through
 * `selectWeeklyRotationTarget`.
 */
export function isoWeekNumber(date: Date): number {
  // Copy and shift to Thursday in current week (ISO week ends Sunday;
  // Thursday is the canonical day for the week-numbering algorithm
  // because every ISO week contains exactly one Thursday).
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - firstThursdayDayNum + 3,
  );
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / weekMs);
}

/**
 * Pick the rotation target for a given week / integration list. Uses a
 * stable modulo: `weekNumber % integrationCount`. The integration list
 * MUST be passed in a stable order (we sort defensively so callers that
 * accept Railway's discovery order don't get rotation jumps when a
 * service is renamed).
 *
 * Empty integration list → empty selection with a reason; the driver
 * surfaces this as an aggregate green note ("no integrations wired").
 */
export function selectWeeklyRotationTarget(
  integrationSlugs: string[],
  date: Date,
): D6ScopingResult {
  if (integrationSlugs.length === 0) {
    return {
      mode: "weekly-rotation",
      selected: [],
      reason: "no integrations wired for D6",
    };
  }
  const sorted = [...integrationSlugs].sort();
  const week = isoWeekNumber(date);
  const idx = week % sorted.length;
  const target = sorted[idx]!;
  return {
    mode: "weekly-rotation",
    selected: [target],
    reason: `week ${week} → index ${idx} of ${sorted.length} (${target})`,
  };
}

/**
 * On-demand mode: read the operator-supplied target from env. Throws
 * loudly if `D6_TARGET_INTEGRATION` is absent — the spec is explicit
 * that on-demand mode requires an explicit target, and silently picking
 * one would produce unpredictable behaviour for operators.
 */
export function selectOnDemandTarget(env: D6ScopingEnv): D6ScopingResult {
  const target = env.D6_TARGET_INTEGRATION;
  if (target === undefined || target === "") {
    throw new Error(
      'D6_MODE="on-demand" requires D6_TARGET_INTEGRATION (the integration slug to run)',
    );
  }
  return {
    mode: "on-demand",
    selected: [target],
    reason: `on-demand target: ${target}`,
  };
}

/**
 * One-shot dispatcher: figure out the mode and pick targets in one call.
 * The driver uses this at tick start; tests use the underlying
 * `select*` functions directly for finer-grained assertions.
 */
export function selectD6Targets(
  env: D6ScopingEnv,
  integrationSlugs: string[],
  date: Date,
): D6ScopingResult {
  const mode = resolveD6Mode(env);
  if (mode === "on-demand") return selectOnDemandTarget(env);
  return selectWeeklyRotationTarget(integrationSlugs, date);
}

/* ─── Reference-snapshot loader ───────────────────────────────────── */

/**
 * Result of attempting to load a reference snapshot. Mirrors the
 * D6 driver's tri-state contract: snapshot present → compare; snapshot
 * absent → skip with a note; snapshot present-but-invalid → loud failure
 * (corrupt fixture is operator-fixable; silently skipping would mask the
 * problem).
 */
export type LoadReferenceResult =
  | { status: "ok"; snapshot: ParitySnapshot; snapshotPath: string }
  | { status: "missing"; snapshotPath: string; reason: string }
  | { status: "invalid"; snapshotPath: string; reason: string };

/**
 * Read + JSON.parse the reference snapshot for one featureType. Missing
 * file maps to `"missing"` (driver skips with a "no reference snapshot"
 * note); JSON parse errors / shape mismatches map to `"invalid"`
 * (driver logs and emits a red row so the corruption is visible).
 *
 * Shape validation is intentionally light: `domElements`, `toolCalls`,
 * `streamProfile`, `contractShape` must all be present with the right
 * top-level types. Per-element validation is the parity engine's job
 * — this loader only catches "this isn't a ParitySnapshot at all"
 * corruption, not "this snapshot's element 5 has a malformed testId"
 * which is a parity comparison concern.
 *
 * `readFile` is injectable so tests can hand in synthetic JSON without
 * touching the disk; production callers omit and get the default
 * `node:fs/promises#readFile`.
 */
export async function loadReferenceSnapshot(
  featureType: D5FeatureType,
  outputDir: string,
  readFileImpl: (
    filePath: string,
    encoding: "utf-8",
  ) => Promise<string> = (filePath, encoding) =>
    fs.readFile(filePath, encoding),
): Promise<LoadReferenceResult> {
  const snapshotPath = path.join(outputDir, `${featureType}.json`);
  let raw: string;
  try {
    raw = await readFileImpl(snapshotPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return {
        status: "missing",
        snapshotPath,
        reason: "no reference snapshot",
      };
    }
    return {
      status: "invalid",
      snapshotPath,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: "invalid",
      snapshotPath,
      reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isParitySnapshot(parsed)) {
    return {
      status: "invalid",
      snapshotPath,
      reason: "shape mismatch (expected ParitySnapshot)",
    };
  }

  return { status: "ok", snapshot: parsed, snapshotPath };
}

function isParitySnapshot(value: unknown): value is ParitySnapshot {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v["domElements"])) return false;
  if (!Array.isArray(v["toolCalls"])) return false;
  const sp = v["streamProfile"];
  if (sp === null || typeof sp !== "object") return false;
  const cs = v["contractShape"];
  if (cs === null || typeof cs !== "object" || Array.isArray(cs)) return false;
  const spr = sp as Record<string, unknown>;
  if (typeof spr["ttft_ms"] !== "number") return false;
  if (typeof spr["p50_chunk_ms"] !== "number") return false;
  if (typeof spr["total_chunks"] !== "number") return false;
  return true;
}
