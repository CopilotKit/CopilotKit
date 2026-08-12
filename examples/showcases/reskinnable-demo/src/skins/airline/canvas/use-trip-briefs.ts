"use client";

import { useCallback, useEffect, useState } from "react";
import type { TripBrief } from "../data/trip-types";

/**
 * BEAT 3d — reads the FILED trip briefs back off the app.
 *
 * The point of the beat is that the artifact belongs to the application and not
 * to the thread, so the canvas must render what the app holds — not what the run
 * said. Everything on screen therefore comes back over `GET
 * /api/airline/v1/briefs`: reload the page, clear the conversation, and the same
 * bytes come back.
 *
 * WHY THIS FETCHES rather than reading a ledger context, which is how logistics,
 * banking, people and commerce feed their canvases. Airline's pages still run on
 * the in-memory `useAirlineData` store; migrating them onto `/ledger` is an
 * explicitly deferred slot (`data/beat-map.md` § "What this slot did NOT
 * build"). When that lands, swap this hook's body for the ledger context's
 * `briefs` and delete the fetch — the surface below reads `TripBrief[]` either
 * way.
 */

export type TripBriefsStatus = "loading" | "ready" | "error";

export interface TripBriefsResult {
  briefs: TripBrief[];
  status: TripBriefsStatus;
  /** Present only when `status === "error"`. What went wrong, for the screen. */
  error: string | null;
  reload: () => void;
}

export const TRIP_BRIEFS_URL = "/api/airline/v1/briefs";

/**
 * Every filed brief, newest first (the store `unshift`s).
 *
 * `reloadKey` re-fetches when it changes. The surface passes the id of the a2ui
 * activity that opened it, so a brief filed in THIS run is fetched after it was
 * written rather than being served from whatever the mount happened to see —
 * without that, the canvas opens on the previous brief and looks like the write
 * silently failed.
 */
export function useTripBriefs(reloadKey?: string | null): TripBriefsResult {
  const [briefs, setBriefs] = useState<TripBrief[]>([]);
  const [status, setStatus] = useState<TripBriefsStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // Guards a `setState` after the surface is dismissed — the "← Back" button
    // unmounts this while the fetch is very much still in flight.
    let live = true;

    const run = async () => {
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch(TRIP_BRIEFS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { briefs?: TripBrief[] };
        if (!live) return;
        setBriefs(Array.isArray(body.briefs) ? body.briefs : []);
        setStatus("ready");
      } catch (err) {
        if (!live) return;
        // Said out loud in BOTH places, for the same reason the attachment chain
        // is: a canvas that opened and then rendered an empty region is
        // indistinguishable from a brief that was never filed, and the presenter
        // has nothing to go on.
        console.error("[airline-canvas] could not read the filed briefs:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    };
    void run();

    return () => {
      live = false;
    };
  }, [reloadKey, nonce]);

  return { briefs, status, error, reload };
}

/**
 * The brief the canvas should show: the one the ops named, or the newest.
 *
 * A named id that is NOT in the list returns `undefined` rather than quietly
 * falling through to the newest — showing a DIFFERENT brief than the one the run
 * filed, under the run's own headline, is worse than showing none.
 */
export function selectBrief(
  briefs: TripBrief[],
  briefId: string | null,
): TripBrief | undefined {
  if (briefId) return briefs.find((b) => b.id === briefId);
  return briefs[0];
}
