import { tick } from "@/skins/keel/data/engine";
import * as store from "@/skins/keel/data/store";
import type { Run } from "@/skins/keel/data/types";

/**
 * TIME LIVES ON THE SERVER. This is the one place it advances.
 *
 * ── The two-clocks problem, and why this is the answer ──────────────────────
 *
 * Keel carries two substrates in one skin: a policy register that does not move
 * at all, and a run engine that does. Before this module the register was served
 * from the store while the RUNS were advanced by a 900 ms `setInterval` inside
 * `useKeelData` on the client. The moment the pages moved onto the REST ledger
 * that arrangement became two clocks over one set of runs: the client would
 * paint progress the server had never heard of, and the next `refresh()` after
 * any write would silently rewind it. Two sources of truth for time is a bug
 * that looks exactly like a slow network.
 *
 * `engine.tick` is PURE and DURATION-DRIVEN — a run's state at an instant is a
 * total function of its stored steps and the clock — so the server needs no
 * timer of its own. SETTLING ON READ yields precisely the value a client ticker
 * would have converged to at the same instant. The client's interval therefore
 * only ever RE-READS (`ledger-context.tsx`'s poll calls `refresh`, never
 * `tick`), and this function is the single writer of elapsed time.
 *
 * ⚠️ IT MUST BE CALLED BY BOTH READ ROUTES — `GET /ledger` and
 * `GET /runs/<runId>`. Settling only the ledger would leave the run-detail page
 * and the register describing different moments of the same run, which is the
 * same disagreement in a smaller window.
 *
 * ── Why the commit is an in-place splice ────────────────────────────────────
 *
 * `data/store.ts` exposes `runs()` (the live array) and commits its own
 * mutations with `db.runs = result.runs`, but exports no setter — and the store
 * is another slot's file. Splicing the settled runs into the array `runs()`
 * hands back IS the commit: `db.runs` keeps pointing at it, so the settlement is
 * durable rather than recomputed on every request, and a subsequent
 * `store.approveStep` composes on settled steps rather than on stale ones. The
 * `tick` fast path returns the SAME array reference when nothing moved, so an
 * idle read does not touch the store at all.
 */
export function settleRuns(): Run[] {
  const committed = store.runs();
  const advanced = tick(committed, Date.now());
  // Reference equality is `tick`'s "nothing moved" signal — see engine.ts.
  if (advanced !== committed) {
    committed.splice(0, committed.length, ...advanced);
  }
  return committed;
}
