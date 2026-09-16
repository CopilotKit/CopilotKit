"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { KEEL_PERSONAS } from "@/skins/keel/data/personas";
import { KEEL_PLAYBOOKS } from "@/skins/keel/data/seed";
import type { KeelLedger } from "@/skins/keel/data/types";

/**
 * Harbor Point's single client-side read of the REST substrate — ONE snapshot
 * fetch of `GET /api/keel/v1/ledger`, shared by every consumer under the
 * provider.
 *
 * MOUNTED in `KeelRuntimeProviders` (`providers.tsx`), beside `RoleProvider` and
 * therefore ABOVE `CopilotKitProvider`, for the reason commerce states in
 * `skins/commerce/data/ledger-context.tsx`: everything below the provider —
 * `Tools`, the layout, the canvas and every page — must read the SAME snapshot,
 * or beat 3b has a panel and a readable one fetch apart. Consumers reach it
 * through `useKeelDesk()` (`desk-data.ts`), which is this snapshot plus the pure
 * derivations and the write paths; only `pages/knowledge.tsx` and
 * `pages/document.tsx` read `useKeelLedger()` directly.
 *
 * WHY A SNAPSHOT AND NOT PER-COLLECTION READS. `GET /ledger` returns documents,
 * runs, playbooks, personas, variances and impact briefs at one instant with an
 * `asOf`. A page that fetched documents, then runs, then variances would have
 * its KPI strip, its rows and its agent readable each describing a slightly
 * different moment — which shows up on stage as the assistant confidently
 * narrating a figure the screen no longer shows.
 *
 * ── WHERE TIME LIVES (the migration's open question, decided and implemented) ─
 *
 * Keel has TWO substrates in one skin: a register that does not move at all, and
 * a run engine that does. `useKeelData` used to advance runs on a 900 ms client
 * interval by calling the pure `engine.tick(runs, now)` while the server held
 * runs as state only. Once the consumers moved onto this provider, keeping both
 * would have put TWO clocks on one set of runs — the client's local advance
 * painting progress the server had never heard of, and the next `refresh()` after
 * any write silently rewinding it. Two sources of truth for time is the failure
 * this decision exists to prevent.
 *
 * THE DECISION: time lives on the SERVER, and the client's only interval
 * RE-READS. That is defensible rather than merely tidy because `engine.tick` is
 * PURE and duration-driven — a run's state at an instant is a total function of
 * its stored steps and the clock — so the server needs no timer either: settling
 * on read yields exactly the value the client interval would have converged to.
 *
 * So the poll below re-fetches while any run is `running`, at the same 900 ms
 * cadence the old ticker used (the motion on screen is unchanged), and stops the
 * moment nothing is running — never an always-on interval. It calls `refresh`.
 * It never calls `tick`. That distinction IS the decision: an interval that
 * re-reads is a rendering cadence over one clock, an interval that advances is a
 * second clock.
 *
 * BOTH HALVES ARE NOW IN PLACE, and neither may be removed without the other:
 *
 *   1. `GET /api/keel/v1/ledger` and `GET /api/keel/v1/runs/<runId>` both SETTLE
 *      runs before returning, through `settleRuns()`
 *      (`src/app/api/keel/v1/settle-runs.ts`), which advances them with
 *      `engine.tick(runs, Date.now())` and COMMITS the result — durable, not
 *      recomputed per request. Both read routes, or the run-detail page and the
 *      register disagree about one run. `settle-runs.test.ts` pins all of that.
 *   2. `useKeelData`'s `setInterval(() => setRuns(tick(...)), 900)` is GONE, and
 *      `data/use-data.ts` with it — deleted in the same change that flipped the
 *      consumers, because it was the only clock until then and keeping it
 *      afterwards is the two-clocks bug this decision exists to prevent.
 *
 * If a future change makes this poll spin against a frozen server, the thing to
 * check is (1): a read route that stopped settling still returns 200 with a
 * well-formed run, and the only symptom is a started run that never moves.
 */

/** What a consumer gets. Deliberately small: a snapshot and a way to re-read it. */
export interface KeelLedgerValue {
  data: KeelLedger;
  /**
   * Re-fetch after a mutation. Every write path calls this, and it refreshes
   * EVERY live instance (see the bus below), not just the one it was called on.
   *
   * Resolves `true` only when a fresh snapshot was actually committed — `false`
   * when the fetch failed or the caller unmounted before the response landed.
   * Any caller that goes on to tell the operator (or the agent) that a write
   * landed MUST check it: a `false` means the rows on screen are still the
   * pre-mutation ones, and "done" printed over them is indistinguishable from a
   * slow network.
   */
  refresh: () => Promise<boolean>;
  /** False until the first fetch resolves, either way. */
  ready: boolean;
}

const LEDGER_URL = "/api/keel/v1/ledger";

/** The poll cadence, matching the ticker it replaces so the motion is unchanged. */
const POLL_MS = 900;

/**
 * The empty snapshot. `playbooks` and `personas` are the real static modules
 * rather than `[]`, because those two never change and a consumer rendering
 * "no playbooks" during the first fetch is a visible flash of a state the app
 * cannot actually be in. Everything the demo MUTATES starts empty.
 */
const EMPTY: KeelLedger = {
  documents: [],
  runs: [],
  playbooks: KEEL_PLAYBOOKS,
  personas: KEEL_PERSONAS,
  variances: [],
  impactBriefs: [],
  asOf: "",
};

/**
 * Cross-instance revalidation bus, exactly as logistics' `useLogistics` uses one.
 *
 * It is needed even under a single provider: beat 3a's e-signature PIN card
 * POSTs through its OWN fetch (the digits go straight from the component to the
 * countersignature route and never pass through this module), so nothing here
 * can notice that write. Without a shared notification the register would still
 * show the revision as awaiting release after the operator released it on stage,
 * which is the one thing that beat has to disprove.
 *
 * NOT exported: `refresh()` on the context value already reaches every listener,
 * so a second public entry point would be a second way to do one thing.
 */
const listeners = new Set<() => Promise<boolean>>();

/**
 * The fetch, the poll and the bus registration — one implementation, two mounts.
 *
 * `enabled` is what lets `useKeelLedger` fall back to a standalone read when no
 * provider is mounted (see that hook) without every consumer under a provider
 * paying for a second fetch. Hooks still run unconditionally; only the network
 * is gated.
 */
function useLedgerSource(enabled: boolean): KeelLedgerValue {
  const [data, setData] = useState<KeelLedger>(EMPTY);
  const [ready, setReady] = useState(false);

  /**
   * ONE liveness flag for EVERY async path here. `refresh` is called from click
   * handlers and tool handlers rather than from an effect, so it has no cleanup
   * of its own to hang a local `cancelled` off — and the shell remounts the whole
   * runtime subtree keyed by skin id, so a skin switch while a mutation's refresh
   * is in flight unmounts this. That is routine operation, not a rare race.
   */
  const live = useRef(true);

  /**
   * The local read. Note the `await` comes FIRST — nothing sets state
   * synchronously, which keeps the effects below off React's cascading-render
   * path (`react-hooks/set-state-in-effect`).
   *
   * It reports failure by RESOLVING FALSE rather than rejecting: rejecting would
   * blank the app mid-demo for what is almost always a dev-server restart, and
   * would turn every bare `await refresh()` call site into an unhandled
   * rejection. The last good snapshot stays on screen.
   */
  const read = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    try {
      const res = await fetch(LEDGER_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snapshot = (await res.json()) as KeelLedger;
      if (!live.current) return false;
      setData(snapshot);
      setReady(true);
      return true;
    } catch (error) {
      console.error("[keel] ledger read failed:", error);
      // Still mark ready: children must render even on a failed first fetch, or
      // a dev-server hiccup leaves the skin blank with no indication of why.
      if (live.current) setReady(true);
      return false;
    }
  }, [enabled]);

  /**
   * The public `refresh`: re-read EVERY live instance, and report whether THIS
   * one committed. `Promise.all` over the bus rather than a bare local read, so
   * a write committed from a tool handler updates the page the operator is
   * looking at even when the two sit in different subtrees.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    // This instance's own read is awaited FIRST in the tuple so its result is
    // the one returned, whether or not it is currently on the bus (it is not,
    // between mount and the registering effect).
    const others = [...listeners].filter((fn) => fn !== read);
    const [mine] = await Promise.all([read(), ...others.map((fn) => fn())]);
    return mine;
  }, [read]);

  // First load + bus registration. The fetch is inlined as a promise chain
  // rather than a call to `read`, because `react-hooks/set-state-in-effect`
  // traces through the callback boundary — invoking any setState-calling
  // function synchronously in an effect body trips it, while setting state
  // inside a `.then` does not.
  useEffect(() => {
    live.current = true;
    listeners.add(read);
    if (enabled) {
      fetch(LEDGER_URL, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<KeelLedger>;
        })
        .then((snapshot) => {
          if (!live.current) return;
          setData(snapshot);
          setReady(true);
        })
        .catch((error) => {
          console.error("[keel] initial ledger fetch failed:", error);
          if (live.current) setReady(true);
        });
    }
    return () => {
      live.current = false;
      listeners.delete(read);
    };
  }, [read, enabled]);

  // THE clock, and it only re-reads — see this file's header. Gated on the
  // boolean rather than on `data`, so the interval is stable while runs keep
  // running and is torn down on the running↔idle edge instead of every tick.
  const anyRunning = data.runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!enabled || !anyRunning) return;
    const id = setInterval(() => {
      void read();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, anyRunning, read]);

  return useMemo<KeelLedgerValue>(
    () => ({ data, refresh, ready }),
    [data, refresh, ready],
  );
}

const KeelLedgerContext = createContext<KeelLedgerValue | null>(null);

/**
 * Publishes ONE ledger snapshot to everything below it.
 *
 * It renders children immediately rather than holding them back on the first
 * fetch. Commerce's provider does the opposite, and is right to: its
 * `useRuntimeProperties` reads the signed-in operator out of the ledger, so
 * mounting early would scope the opening run to a placeholder identity. Keel's
 * identity does NOT come from here — `useKeelRuntimeProperties` reads
 * `RoleProvider`, whose personas are a static module — so there is nothing to
 * race, and gating the tree would only add a blank frame to every skin switch.
 * Consumers read `ready` when they need to distinguish "empty" from "not yet".
 */
export function KeelLedgerProvider({ children }: { children: ReactNode }) {
  const value = useLedgerSource(true);
  return (
    <KeelLedgerContext.Provider value={value}>
      {children}
    </KeelLedgerContext.Provider>
  );
}

/**
 * Read the ledger.
 *
 * Outside the provider it falls back to a standalone read of its own rather than
 * throwing. That is keel's own convention (`useRole` does the same, and says
 * why), and here it is load-bearing twice over: this provider ships UNMOUNTED,
 * so a throwing hook would hard-crash the Register the moment a page adopted it;
 * and a page rendered in isolation — a test, a single-component harness — still
 * has to work. The cost of the fallback is one fetch per orphaned consumer,
 * which the `enabled` gate keeps at zero for everything under the provider.
 *
 * The context is either present for a component's whole lifetime or absent for
 * it, so the hook order below is stable.
 */
export function useKeelLedger(): KeelLedgerValue {
  const ctx = useContext(KeelLedgerContext);
  const standalone = useLedgerSource(ctx === null);
  return ctx ?? standalone;
}
