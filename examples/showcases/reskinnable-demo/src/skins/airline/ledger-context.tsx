"use client";

/**
 * Aeronova's REST ledger, read once and shared.
 *
 * ⚠️ SHIPPED UNMOUNTED, ON PURPOSE. Nothing renders `AirlineLedgerProvider`
 * today: `skin.tsx` belongs to a later slot, and this slot must not touch it.
 * The in-memory `useAirlineData` store is still the live substrate for the
 * Trip / Loyalty / Disruptions pages, exactly as `data/beat-map.md` §
 * "It is ADDITIVE" requires. The two REST-backed pages this slot adds
 * (`pages/account.tsx`, `pages/rebook.tsx`) read THIS hook and are likewise
 * unreachable until that slot wires them.
 *
 * TO MOUNT IT — three edits, all in files this slot does not own:
 *
 *   1. `skin.tsx` → `Providers: AirlineLedgerProvider` (or compose it into an
 *      existing stack). It belongs BELOW `CopilotKitProvider`; it contributes
 *      no runtime identity, so it does not need `RuntimeProviders`.
 *   2. `skin.tsx` → `nav: airlineNav` (from `./nav`) and `resolvePage:
 *      resolveAirlinePage` (from `./pages`) — that is what makes the two new
 *      pages reachable at all.
 *   3. Any tool that WRITES through `/api/airline/v1/*` must call
 *      `notifyAirlineDataChanged()` afterwards (see below).
 *
 * WHY A CONTEXT RATHER THAN LOGISTICS' PER-INSTANCE HOOK. `useLogistics()`
 * refetches per call site; that is affordable there because it pulls five small
 * collections. Aeronova publishes ONE cross-cutting snapshot (`GET /ledger`
 * returns profile, travelers, flights, bookings, options, exceptions and briefs
 * together), and beat 3b asks the agent to describe exactly what the passenger
 * can see — so two panels on one screen disagreeing about the ledger is the
 * specific failure this must not have. One fetch, one state, one answer.
 *
 * The revalidation bus is kept from logistics verbatim in spirit: a write that
 * goes straight from a chat card to a route (beat 3a's card confirmation does
 * exactly that) cannot be noticed by this module, so it has to be told.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  BookingDto,
  FareException,
  Flight,
  RebookingOption,
  TravelProfile,
  Traveler,
  TripBrief,
} from "./data/trip-types";

/** Exactly the shape `store.snapshot()` publishes. `waiverGround` is stripped there. */
export interface AirlineLedger {
  now: string;
  /** `null` only before the first read lands — see `ready`. */
  profile: TravelProfile | null;
  travelers: Traveler[];
  flights: Flight[];
  bookings: BookingDto[];
  options: RebookingOption[];
  exceptions: FareException[];
  briefs: TripBrief[];
}

export interface AirlineLedgerValue extends AirlineLedger {
  /**
   * False until the first fetch settles. Pages use it to tell "still loading"
   * from "genuinely empty" — a distinction beat 3b's readable has to make, or
   * the agent narrates an empty account to a room looking at a populated one.
   */
  ready: boolean;
  refresh: () => void;
}

const EMPTY: AirlineLedger = {
  now: "",
  profile: null,
  travelers: [],
  flights: [],
  bookings: [],
  options: [],
  exceptions: [],
  briefs: [],
};

/**
 * Cross-instance revalidation bus. The provider registers its refetch; any
 * mutation calls `notifyAirlineDataChanged()` so the screen re-pulls.
 *
 * Exported because beat 3a's card confirmation POSTs to `/authorizations` from
 * inside a chat card, never through this module — so nothing here can observe
 * that write. Without a notification the trip record would still show the old
 * itinerary after the passenger authorized the change on stage, which is the
 * one thing that beat has to disprove.
 */
const listeners = new Set<() => void>();

export function notifyAirlineDataChanged() {
  for (const listener of listeners) listener();
}

const LedgerContext = createContext<AirlineLedgerValue | null>(null);

const BASE = "/api/airline/v1";

export function AirlineLedgerProvider({ children }: { children: ReactNode }) {
  const [ledger, setLedger] = useState<AirlineLedger>(EMPTY);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(`${BASE}/ledger`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Partial<AirlineLedger>;
        // Spread over EMPTY rather than trusting the body's shape: a route that
        // grows or drops a collection must not crash every `.map` downstream.
        setLedger({ ...EMPTY, ...body });
      } catch (error) {
        console.error("[airline] GET /ledger failed:", error);
        // Keep whatever was last read. Blanking the screen on a transient
        // failure would be a worse lie than showing slightly stale trips.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);

  const value = useMemo<AirlineLedgerValue>(
    () => ({ ...ledger, ready, refresh }),
    [ledger, ready, refresh],
  );

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}

/**
 * The shared ledger.
 *
 * THROWS outside the provider, deliberately. The alternative — returning an
 * empty ledger — renders a blank account and an empty rebooking board, which on
 * stage is indistinguishable from a seed that failed to load and sends the
 * presenter hunting through the API instead of the one missing `Providers`
 * line. See this file's header for the three edits that mount it.
 */
export function useAirlineLedger(): AirlineLedgerValue {
  const value = useContext(LedgerContext);
  if (!value) {
    throw new Error(
      "useAirlineLedger() was called outside <AirlineLedgerProvider>. " +
        "Set `Providers: AirlineLedgerProvider` on the airline skin in " +
        "src/skins/airline/skin.tsx — see src/skins/airline/ledger-context.tsx.",
    );
  }
  return value;
}
