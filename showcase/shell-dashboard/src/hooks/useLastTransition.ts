"use client";
import { useEffect, useState } from "react";
import { pb } from "../lib/pb";

/**
 * A `status_history` row per the PB migration (1745193700_init_status_history).
 * Schema columns: key, dimension, state, transition, signal, observed_at.
 *
 * NOTE: the schema does NOT carry `state_from`/`state_to` columns. The
 * `transition` enum (e.g. `green_to_red`) is the source of truth for the
 * before/after pair; `deriveFromTo()` parses it.
 */
export interface TransitionRow {
  id: string;
  key: string;
  dimension: string;
  /** Enum: first | green_to_red | red_to_green | sustained_red | sustained_green | error */
  transition: string;
  /** Row state at the moment of the transition (green | red | degraded). */
  state: string;
  observed_at: string;
}

export interface FromTo {
  from: string | null;
  to: string | null;
}

/**
 * Parse a `transition` enum string into (from, to) for tooltip copy.
 * Unknown / sustained / first / error yield best-effort nulls so callers
 * can fall back to the generic `state` + `observed_at` display.
 */
export function deriveFromTo(transition: string): FromTo {
  switch (transition) {
    case "green_to_red":
      return { from: "green", to: "red" };
    case "red_to_green":
      return { from: "red", to: "green" };
    case "sustained_red":
      return { from: "red", to: "red" };
    case "sustained_green":
      return { from: "green", to: "green" };
    default:
      // "first" / "error" / anything unexpected: we don't know the prior.
      return { from: null, to: null };
  }
}

export interface UseLastTransitionResult {
  row: TransitionRow | null;
  loaded: boolean;
  error: string | null;
}

// Session-lifetime cache. One-shot lazy fetch per key — second hover of
// the same red/degraded cell does not refetch (spec §5.6).
//
// Two separate caches so a transient fetch error doesn't pollute the
// row cache, but repeated hovers while the server is unreachable don't
// hammer PB either. Error entries TTL at ERROR_TTL_MS.
//
// Eviction: LRU (move-to-end on read + set). Frequently-hit entries stay
// hot; only genuinely cold entries fall off once the cache reaches CACHE_MAX.
interface CachedRow {
  row: TransitionRow | null;
}
interface CachedError {
  error: string;
  at: number;
}
const CACHE_MAX = 500;
const ERROR_TTL_MS = 30_000;
const rowCache = new Map<string, CachedRow>();
const errorCache = new Map<string, CachedError>();

function rowCacheGet(key: string): CachedRow | undefined {
  const entry = rowCache.get(key);
  if (entry === undefined) return undefined;
  // LRU touch: delete + re-insert moves the entry to the end of iteration
  // order so it's the last to be evicted.
  rowCache.delete(key);
  rowCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, row: TransitionRow | null): void {
  // If this key already exists, remove it first so the re-insert lands at
  // the end of iteration order (LRU semantics on write-as-touch).
  if (rowCache.has(key)) rowCache.delete(key);
  while (rowCache.size >= CACHE_MAX) {
    // Evict oldest (least-recently-used) entry.
    const oldest = rowCache.keys().next().value;
    if (oldest === undefined) break;
    rowCache.delete(oldest);
  }
  rowCache.set(key, { row });
  // A successful row clears any stale error entry for the same key —
  // otherwise a transient failure would keep returning `error` alongside
  // a now-valid row. (Caches are kept distinct but must not disagree.)
  errorCache.delete(key);
}

function errorCacheSet(key: string, err: string): void {
  if (errorCache.has(key)) errorCache.delete(key);
  while (errorCache.size >= CACHE_MAX) {
    const oldest = errorCache.keys().next().value;
    if (oldest === undefined) break;
    errorCache.delete(oldest);
  }
  errorCache.set(key, { error: err, at: Date.now() });
  // Symmetry with cacheSet: an error supersedes any prior successful row,
  // so drop the row so callers don't see stale-row + fresh-error simultaneously.
  rowCache.delete(key);
}

function errorCacheGet(key: string): string | null {
  const entry = errorCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ERROR_TTL_MS) {
    errorCache.delete(key);
    return null;
  }
  // LRU touch on read.
  errorCache.delete(key);
  errorCache.set(key, entry);
  return entry.error;
}

/** Test helper — not exported from the package surface. */
export function __clearLastTransitionCache(): void {
  rowCache.clear();
  errorCache.clear();
}

/**
 * Lazy one-shot fetch of the newest `status_history` row for a given
 * PB `key`, triggered only when `enabled === true` (i.e. tooltip open).
 * Cached per key for the session; errors are cached for 30s to avoid
 * hammering PB if the user re-hovers the same cell.
 *
 * Intended usage: `useLastTransition(ctx.key, tooltipOpen)` where
 * `ctx.key` is `smoke:<slug>/<featureId>` / `health:<slug>` / etc.
 */
export function useLastTransition(
  key: string,
  enabled: boolean,
): UseLastTransitionResult {
  const [row, setRow] = useState<TransitionRow | null>(() => {
    const cached = rowCacheGet(key);
    return cached ? (cached.row ?? null) : null;
  });
  const [loaded, setLoaded] = useState<boolean>(() => rowCache.has(key));
  const [error, setError] = useState<string | null>(() => errorCacheGet(key));

  // `useState` initializers only run once (on mount). When `key` changes
  // for the same hook instance (e.g. hover moves between cells), we must
  // reset state to reflect the new key's cache entries instead of leaving
  // stale row/error from the previous key visible until the fetch resolves.
  useEffect(() => {
    const cachedRow = rowCacheGet(key);
    const cachedErr = errorCacheGet(key);
    setRow(cachedRow ? (cachedRow.row ?? null) : null);
    setError(cachedErr);
    setLoaded(cachedRow !== undefined || cachedErr !== null);
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const cached = rowCacheGet(key);
    if (cached !== undefined) {
      setRow(cached.row ?? null);
      setError(null);
      setLoaded(true);
      return;
    }
    const cachedErr = errorCacheGet(key);
    if (cachedErr) {
      setError(cachedErr);
      setRow(null);
      setLoaded(true);
      return;
    }
    let alive = true;
    (async (): Promise<void> => {
      try {
        // Parameterized filter via PB SDK helper — avoids injection and
        // handles quoting/escaping per `pb.filter` semantics.
        const filter = pb.filter("key = {:key}", { key });
        const resp = await pb
          .collection("status_history")
          .getList<TransitionRow>(1, 1, {
            filter,
            sort: "-observed_at",
          });
        const first = resp.items[0] ?? null;
        cacheSet(key, first);
        if (!alive) return;
        setRow(first);
        setError(null);
        setLoaded(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorCacheSet(key, msg);
        if (!alive) return;
        setError(msg);
        setRow(null);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  return { row, loaded, error };
}
