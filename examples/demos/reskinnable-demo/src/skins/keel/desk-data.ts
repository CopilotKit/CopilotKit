"use client";

import { useCallback, useMemo } from "react";
import { useRole } from "@/skins/keel/role-context";
import { useKeelLedger } from "@/skins/keel/ledger-context";
import type {
  ApprovalItem,
  DocumentRecord,
  ImpactBrief,
  KeelKpis,
  Persona,
  Playbook,
  Run,
  StartRunInput,
  Variance,
} from "@/skins/keel/data/types";

/**
 * THE desk hook — everything Keel's chrome, pages, tools and canvas read.
 *
 * It replaces `data/use-data.ts` (`useKeelData`), which held runs in `useState`,
 * mutated them through the pure engine on the client, and advanced them on a
 * 900 ms `setInterval`. That hook and its `skin.useData` registration are gone;
 * `useSkinData<KeelData>()` now returns `undefined` for keel, exactly as it does
 * for the other four REST-backed skins.
 *
 * ── WHAT CHANGED, AND WHY IT HAD TO ─────────────────────────────────────────
 *
 * ONE SUBSTRATE. Runs and the policy register are now the same ledger, read
 * through `useKeelLedger()` — one snapshot fetch of `GET /api/keel/v1/ledger`,
 * shared by every consumer under `KeelLedgerProvider`. Before this, the register
 * came from the server and the runs came from client state, so a run the agent
 * started through a REST tool and a run the page showed were two different
 * objects with two different histories.
 *
 * ONE CLOCK. Elapsed time is settled SERVER-SIDE on every read (see
 * `src/app/api/keel/v1/settle-runs.ts`); the provider's interval only re-reads.
 * The deleted `setInterval(() => setRuns(tick(...)), 900)` was the second clock
 * — it painted progress the server had never heard of, and the next `refresh()`
 * after any write silently rewound it.
 *
 * MUTATIONS ARE ASYNC, and that is not incidental. Every write is an HTTP POST
 * followed by a re-read, so the four mutators return promises where `KeelData`'s
 * returned synchronously. Callers must `await` them before telling the operator
 * — or the agent — that anything landed. `DeskMutationResult` carries the third
 * outcome that only exists once a write crosses the network: `stale`, meaning
 * the WRITE succeeded and the RE-READ did not, so the rows on screen are still
 * the pre-mutation ones. Reporting that as a plain success is indistinguishable
 * from a slow network, which is the failure the ledger's `refresh` contract
 * exists to make impossible to ignore.
 *
 * The derivations below (`approvals`, `kpis`, `summaryKey`, the cycle-time
 * median) are carried over from `useKeelData` unchanged in behaviour — they were
 * always pure functions of a run list and a persona, and nothing about them
 * cared where the runs came from.
 */

/** Wall-clock cycle time of a completed run: first start → last completion. */
function runCycleTimeMs(run: Run): number | null {
  if (run.status !== "completed") return null;
  const completions = run.steps
    .map((s) => s.completedAt)
    .filter((v): v is string => Boolean(v))
    .map((v) => Date.parse(v));
  if (completions.length === 0) return null;
  const start = Date.parse(run.steps[0]?.startedAt ?? run.createdAt);
  const end = Math.max(...completions);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * The result of a desk write.
 *
 * `stale` is the outcome a synchronous in-memory store could not have: the POST
 * returned 2xx and the follow-up ledger read did not. The write LANDED; the
 * screen did not move. Callers surface `reason` whenever it is present —
 * including on `ok: true` — because "recorded, but this view is behind" is
 * information the operator needs and a bare green tick actively hides.
 */
export interface DeskMutationResult {
  ok: boolean;
  reason?: string;
  stale?: boolean;
}

export interface StartRunOutcome extends DeskMutationResult {
  run?: Run;
}

/**
 * The read half of the desk — structurally the read half of the old `KeelData`,
 * so anything that only ever LOOKED at the data (the OGUI snapshot projection,
 * the canvas renderers) takes this type and is satisfied by either.
 */
export interface KeelDeskView {
  playbooks: Playbook[];
  runs: Run[];
  persona: Persona;
  getRun: (runId: string) => Run | undefined;
  getPlaybook: (playbookId: string) => Playbook | undefined;
  approvals: ApprovalItem[];
  approvalsForMe: ApprovalItem[];
  kpis: KeelKpis;
  /**
   * A string that changes ONLY on a meaningful state transition — never on a
   * raw settle. Agent-context readables memoize on this to avoid churn.
   */
  summaryKey: string;
}

export interface KeelDesk extends KeelDeskView {
  /** False until the first ledger fetch resolves, either way. */
  ready: boolean;
  /** The instant the SERVER measured this snapshot. `""` before the first read. */
  asOf: string;
  documents: DocumentRecord[];
  variances: Variance[];
  impactBriefs: ImpactBrief[];
  /** Re-read the ledger. Resolves false when the fetch failed. */
  refresh: () => Promise<boolean>;

  startRun: (
    playbookId: string,
    input: StartRunInput,
  ) => Promise<StartRunOutcome>;
  approveStep: (
    runId: string,
    stepId: string,
    note?: string,
  ) => Promise<DeskMutationResult>;
  rejectStep: (
    runId: string,
    stepId: string,
    note?: string,
  ) => Promise<DeskMutationResult>;
  cancelRun: (runId: string) => Promise<DeskMutationResult>;
}

/** The message a caller shows when the network itself failed. */
const UNREACHABLE = "The desk could not be reached. Nothing was recorded.";

/**
 * The one POST path every desk write shares, so the ok/reason/stale contract
 * cannot be gotten subtly different by the next mutation added here.
 *
 * A refusal's `message` is relayed VERBATIM: the routes write those to be read
 * by a human and by the agent (the release gate names the body that has not
 * endorsed; the approve gate distinguishes "not found" from "already advanced"
 * from "wrong role"), and flattening them into one house string costs exactly
 * the information that tells a caller whether to retry, switch persona, or stop.
 */
async function postWrite(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; reason?: string; payload?: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `That request was refused (HTTP ${res.status}).`;
      return { ok: false, reason: message };
    }
    return { ok: true, payload };
  } catch (error) {
    console.error(`[keel] write to ${url} failed:`, error);
    return { ok: false, reason: UNREACHABLE };
  }
}

export function useKeelDesk(): KeelDesk {
  const { persona } = useRole();
  const { data, refresh, ready } = useKeelLedger();
  const personaId = persona.id;

  const { runs, playbooks, documents, variances, impactBriefs, asOf } = data;

  /**
   * Write, then re-read, then report all three outcomes. The re-read is awaited
   * rather than fired and forgotten precisely so `stale` can be told apart from
   * success — see `DeskMutationResult`.
   */
  const write = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
    ): Promise<{
      ok: boolean;
      reason?: string;
      stale?: boolean;
      payload?: unknown;
    }> => {
      const result = await postWrite(url, { ...body, personaId });
      if (!result.ok) return { ok: false, reason: result.reason };
      const refreshed = await refresh();
      return refreshed
        ? { ok: true, payload: result.payload }
        : {
            ok: true,
            stale: true,
            reason:
              "That was recorded, but this view could not be refreshed — what is on screen is still the state from before it.",
            payload: result.payload,
          };
    },
    [personaId, refresh],
  );

  const startRun = useCallback(
    async (
      playbookId: string,
      input: StartRunInput,
    ): Promise<StartRunOutcome> => {
      const result = await write("/api/keel/v1/runs", {
        playbookId,
        subject: input.subject,
        values: input.values,
      });
      return {
        ok: result.ok,
        reason: result.reason,
        stale: result.stale,
        run: (result.payload as Run | undefined) ?? undefined,
      };
    },
    [write],
  );

  const approveStep = useCallback(
    (runId: string, stepId: string, note?: string) =>
      write(
        `/api/keel/v1/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/approve`,
        { note },
      ).then(({ ok, reason, stale }) => ({ ok, reason, stale })),
    [write],
  );

  const rejectStep = useCallback(
    (runId: string, stepId: string, note?: string) =>
      write(
        `/api/keel/v1/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/reject`,
        { note },
      ).then(({ ok, reason, stale }) => ({ ok, reason, stale })),
    [write],
  );

  const cancelRun = useCallback(
    (runId: string) =>
      write(`/api/keel/v1/runs/${encodeURIComponent(runId)}/cancel`, {}).then(
        ({ ok, reason, stale }) => ({ ok, reason, stale }),
      ),
    [write],
  );

  const getRun = useCallback(
    (runId: string): Run | undefined => runs.find((r) => r.id === runId),
    [runs],
  );
  const getPlaybook = useCallback(
    (playbookId: string): Playbook | undefined =>
      playbooks.find((p) => p.id === playbookId),
    [playbooks],
  );

  const approvals = useMemo<ApprovalItem[]>(() => {
    const items: ApprovalItem[] = [];
    for (const run of runs) {
      if (run.status !== "blocked") continue;
      const step = run.steps.find((s) => s.status === "awaiting_approval");
      if (!step) continue;
      items.push({ run, step, actionable: step.approverRole === persona.role });
    }
    return items;
  }, [runs, persona.role]);

  const approvalsForMe = useMemo(
    () => approvals.filter((a) => a.actionable),
    [approvals],
  );

  const kpis = useMemo<KeelKpis>(() => {
    const openRuns = runs.filter(
      (r) =>
        r.status === "running" ||
        r.status === "blocked" ||
        r.status === "queued",
    ).length;
    const cycleTimes = runs
      .map(runCycleTimeMs)
      .filter((n): n is number => n !== null);
    return {
      openRuns,
      blockedRuns: runs.filter((r) => r.status === "blocked").length,
      completedRuns: runs.filter((r) => r.status === "completed").length,
      approvalsForMe: approvalsForMe.length,
      medianCycleTimeMs: cycleTimes.length > 0 ? median(cycleTimes) : null,
    };
  }, [runs, approvalsForMe]);

  /**
   * The churn guard: a string keyed ONLY on (runId, status, currentStepId)
   * tuples — never on elapsed time or timestamps — so a step's ticking clock
   * does not invalidate the agent-context readables that memoize on it. It
   * matters MORE now than it did under the old hook: the poll re-reads the whole
   * ledger every 900 ms while a run is live, so every one of those snapshots is
   * a fresh object identity.
   */
  const summaryKey = useMemo(
    () =>
      runs
        .map((r) => {
          const active = r.steps.find(
            (s) => s.status === "running" || s.status === "awaiting_approval",
          );
          const currentStepId =
            active?.id ?? r.steps[r.steps.length - 1]?.id ?? "";
          return `${r.id}:${r.status}:${currentStepId}`;
        })
        .join("|"),
    [runs],
  );

  return useMemo<KeelDesk>(
    () => ({
      ready,
      asOf,
      documents,
      variances,
      impactBriefs,
      playbooks,
      runs,
      persona,
      refresh,
      getRun,
      getPlaybook,
      approvals,
      approvalsForMe,
      kpis,
      summaryKey,
      startRun,
      approveStep,
      rejectStep,
      cancelRun,
    }),
    [
      ready,
      asOf,
      documents,
      variances,
      impactBriefs,
      playbooks,
      runs,
      persona,
      refresh,
      getRun,
      getPlaybook,
      approvals,
      approvalsForMe,
      kpis,
      summaryKey,
      startRun,
      approveStep,
      rejectStep,
      cancelRun,
    ],
  );
}
