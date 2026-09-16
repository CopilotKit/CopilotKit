"use client";

import { useCallback, useRef, useState } from "react";

/**
 * ONE write in flight per surface, guarded SYNCHRONOUSLY.
 *
 * `useState` alone does not close the window. Two clicks dispatched before React
 * commits the `disabled` attribute both read the same `busy === null` out of
 * their closure, so the write fires TWICE — and every write in this skin is
 * guarded by the store against exactly that: the second call comes back
 * `ALREADY_FINALIZED`, `ALREADY_DECIDED` or `ALREADY_REFUNDED` and the surface
 * paints a refusal on an action that SUCCEEDED. Being told the thing you just did
 * failed is the worst available outcome on a demo control surface, because the
 * presenter's only recourse on stage is to do it again.
 *
 * So `busy` is the VISIBLE half — it disables the levers and renders
 * "Finalizing…" — and the ref is what makes `run` a mutex on its own, so a lever
 * that forgets `disabled` (or an element that has no such attribute to forget)
 * cannot reopen the hole. Both halves are wanted; only the ref is sufficient.
 *
 * The guard is per-SURFACE rather than per-button: while a waiver is being filed
 * the panel's other levers are refused too, since interleaving them is the same
 * race by another route (finalize a draft while the filing that would replace it
 * is still in flight).
 *
 * THE GRANULARITY RULE, which is what decides where a caller mounts an instance:
 * an instance must be AT LEAST AS COARSE as the MESSAGE CHANNEL the writes it
 * guards share. Two controls that report into one slot must share one instance, or
 * a refusal from the first is erased by the second's success and the refused write
 * ends up saying nothing at all — the same silent no-op this hook exists to
 * prevent, reached through the report instead of the request. All three callers
 * are worked examples: `pages/promotions.tsx` mounts ONE per card (four levers,
 * two surfaces, one record); `pages/returns.tsx` mounts one per PAGE for its
 * decisions, because every decision reports through the page's single notice —
 * while its refund control, which has its own inline slot, holds its own; and
 * `pages/orders.tsx` mounts one per ROW, because its hold and clear-exception
 * levers speak about one order and report into that row's own slot.
 *
 * Coarser is therefore not automatically safer: the rule sets a FLOOR, and the
 * channel is what sets it. Orders' rows deliberately do not share a guard, since
 * a write on one row can never speak for another row's slot.
 *
 * `run` resolves the action's own "did it land" boolean, and `false` when it
 * declined to start OR when the action never completed at all — so a caller may
 * treat the resolved value as "this write definitely landed" and nothing else.
 * It never REJECTS, which is why every call site can be a bare `void run(...)`:
 * a rejecting `fetch` used to escape the click handler as an unhandled rejection,
 * and a caller that had asked "did it land" would then never get an answer and
 * would fall through to clearing what the user typed.
 *
 * It lives in `components/` beside the skin's other shared hook rather than inside
 * the page that first needed it, because a hook exported from a PAGE does not read
 * as importable: the second page that needed this grew a weaker `useState`-only
 * copy instead — no mutex and no `finally`, so a rejecting fetch wedged its button
 * on "Issuing…" until the presenter reloaded. One definition, every caller.
 *
 * Exported (rather than inlined at each surface) also for its own test: jsdom does
 * not dispatch clicks to a `disabled` button, so a rendered double-click can only
 * ever exercise the visible half.
 */
export function useInFlight() {
  const inFlight = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, action: () => Promise<boolean>): Promise<boolean> => {
      if (inFlight.current !== null) return false;
      inFlight.current = key;
      setBusy(key);
      try {
        return await action();
      } catch (error) {
        // The write handlers themselves surface every REFUSAL on the surface.
        // This is the narrower case they cannot: the request never produced a
        // response, so there is nothing to report about — least of all success.
        console.error(`[commerce] the ${key} write did not complete`, error);
        return false;
      } finally {
        inFlight.current = null;
        setBusy(null);
      }
    },
    [],
  );

  return { busy, run };
}

/** One mounted guard, for a surface that hands its own down to a child. */
export type InFlight = ReturnType<typeof useInFlight>;
