import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKeelData } from "./use-data";
import { RoleProvider, useRole } from "@/skins/keel/role-context";
import type { KeelData, RunStatus } from "./types";

/**
 * Regression lock for the `runsRef` staleness class (convergence audit lever A):
 *
 *  - F2 (write side): ALL FOUR mutations — startRun, approveStep, rejectStep AND
 *    cancelRun — commit through the one shared functional path, or a same-tick
 *    double-dispatch loses the first update (both reads see the same pre-commit
 *    ref). cancelRun is NOT exempt: it used to do a bare `setRuns(result.runs)`
 *    off the ref (symptom A1), which drops a concurrently-committed run.
 *  - F1 (read side): `getRun` must read reactive `runs`, not the post-commit
 *    `runsRef`, or a render-time caller in the mutation's own commit reads one
 *    commit stale.
 *  - A4 (returned identity): a raced startRun must return the id it actually
 *    commits — the id is minted off a monotonic counter, never re-derived on the
 *    recompute branch, so the HITL card never names a run that was never inserted.
 *  - A5 (honest commit): a mutation's RETURN must report what actually committed,
 *    never a value pre-computed off the stale ref. Two same-batch approvals on one
 *    gate: the first consumes it; the second, computed against the first's
 *    committed state, must be told `ok:false` — not a false success for an
 *    approval that never happened — and the committed run must match that answer.
 *
 * All are exercised through the real hook (no engine stubbing), so a future
 * edit that reintroduces `setRuns(result.runs)` off the ref, `runsRef.current.find`,
 * a recompute-branch id re-mint, or a pre-computed (rather than committed) return
 * turns this suite red.
 */

interface Harness {
  /** Latest committed KeelData. */
  latest: () => KeelData;
  /** One entry per render: what getRun vs. runs report for a given run id. */
  observations: Array<{ fromGetRun?: RunStatus; fromRuns?: RunStatus }>;
  observeId: string;
}

function mountHarness(observeId: string, personaId?: string): Harness {
  const observations: Harness["observations"] = [];
  let current: KeelData | undefined;
  let setPersonaId: ((id: string) => void) | undefined;

  function Probe() {
    const data = useKeelData();
    current = data;
    setPersonaId = useRole().setPersonaId;
    // Render-time reads: exactly the pattern run-detail/tools use.
    observations.push({
      fromGetRun: data.getRun(observeId)?.status,
      fromRuns: data.runs.find((r) => r.id === observeId)?.status,
    });
    return null;
  }

  // Wrap in RoleProvider so tests can select the persona whose role actions a
  // given gate (the default persona, Ana Reyes, approves none of the seeds). With
  // no personaId this defaults to Ana Reyes — identical to the bare-render tests.
  act(() => {
    render(
      <RoleProvider>
        <Probe />
      </RoleProvider>,
    );
  });
  if (personaId) {
    act(() => setPersonaId?.(personaId));
  }

  return {
    latest: () => {
      if (!current) throw new Error("Probe never rendered");
      return current;
    },
    observations,
    observeId,
  };
}

afterEach(() => {
  // jsdom is torn down by the environment; nothing persistent to reset.
});

describe("useKeelData — runsRef staleness class", () => {
  it("F2: two startRun dispatches in one commit both survive (no lost update)", () => {
    const h = mountHarness("RUN-none");
    const seedCount = h.latest().runs.length;

    act(() => {
      h.latest().startRun("adverse-event", { subject: "Event A" });
      h.latest().startRun("adverse-event", { subject: "Event B" });
    });

    const runs = h.latest().runs;
    // Both new runs must be present. Ids are minted off the CURRENT list, so a
    // lost update would collapse them onto the same id and drop one run.
    expect(runs.length).toBe(seedCount + 2);
    const subjects = runs.map((r) => r.subject);
    expect(subjects).toContain("Event A");
    expect(subjects).toContain("Event B");
    const ids = runs.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  it("F1: getRun never disagrees with runs in the mutation's own commit render", () => {
    // RUN-1043 is a seeded running run; cancelRun (now routed through the shared
    // functional commit) flips its status in one commit, isolating the getRun
    // read from the write path.
    const h = mountHarness("RUN-1043");
    expect(h.latest().getRun("RUN-1043")?.status).toBe("running");

    act(() => {
      h.latest().cancelRun("RUN-1043");
    });

    expect(h.latest().getRun("RUN-1043")?.status).toBe("cancelled");
    // The load-bearing assertion: in EVERY render (including the mutation's own
    // commit, before the post-commit ref-sync effect fires) getRun agreed with
    // reactive runs. A ref-backed getRun would diverge on that commit render.
    for (const o of h.observations) {
      expect(o.fromGetRun).toBe(o.fromRuns);
    }
    // And prove we actually captured the transition (running → cancelled),
    // otherwise the loop above could pass vacuously.
    const statuses = h.observations.map((o) => o.fromRuns);
    expect(statuses).toContain("running");
    expect(statuses).toContain("cancelled");
  });

  it("A1: a cancelRun interleaved with a startRun in one commit keeps BOTH", () => {
    // The interleave that a non-functional cancelRun (`setRuns(result.runs)` off
    // the ref) silently drops: the startRun commits first, then cancelRun's
    // updater runs against a prev that already contains the new run. Off the
    // stale ref, cancelRun would overwrite that prev and lose the started run;
    // through the shared functional commit it recomputes from prev and keeps it.
    const h = mountHarness("RUN-1043"); // seeded running run
    const seedCount = h.latest().runs.length;

    act(() => {
      h.latest().startRun("adverse-event", { subject: "Interleaved start" });
      h.latest().cancelRun("RUN-1043");
    });

    const runs = h.latest().runs;
    // The started run survived the cancel's commit …
    expect(runs.length).toBe(seedCount + 1);
    expect(runs.map((r) => r.subject)).toContain("Interleaved start");
    // … and the cancel actually applied to the seeded run.
    expect(runs.find((r) => r.id === "RUN-1043")?.status).toBe("cancelled");
  });

  it("A4: a raced startRun returns the id it actually commits (unique, honest)", () => {
    // Two startRuns in one commit batch: the second is forced onto the recompute
    // branch. Its returned id must be the id that lands — minted off the monotonic
    // counter, so the two dispatches get DISTINCT ids and each is findable under
    // the id it reported. A recompute-branch id re-mint would strand the second
    // run under an id its return never named (A4).
    const h = mountHarness("RUN-none");

    let idA: string | undefined;
    let idB: string | undefined;
    act(() => {
      idA = h.latest().startRun("adverse-event", { subject: "Event A" })
        .run?.id;
      idB = h.latest().startRun("adverse-event", { subject: "Event B" })
        .run?.id;
    });

    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).not.toBe(idB); // honest & unique — not the same re-derived id

    const runs = h.latest().runs;
    // Each returned id names the run that actually committed, with the right subject.
    expect(runs.find((r) => r.id === idA)?.subject).toBe("Event A");
    expect(runs.find((r) => r.id === idB)?.subject).toBe("Event B");
  });

  it("A5: a second same-batch approval on an already-consumed gate is told ok:false", () => {
    // THE finding. RUN-1044 is blocked at its `scope-review` gate, actionable by a
    // Privacy Officer. Two approveStep dispatches on that one gate in a SINGLE
    // React batch: the first consumes it; the second is computed against the
    // first's COMMITTED state (via the synchronous mirror), not a pre-commit ref.
    // A return that reported `compute(runsRef.current)` would tell the second
    // caller ok:true — a false success for an approval that never happened, which
    // the HITL card / approvals queue would surface. The honest return tells it
    // ok:false, and the committed run must match: the gate was approved exactly
    // once.
    const h = mountHarness("RUN-1044", "sam-okafor"); // Privacy Officer
    expect(h.latest().getRun("RUN-1044")?.status).toBe("blocked");

    let first: { ok: boolean; reason?: string } | undefined;
    let second: { ok: boolean; reason?: string } | undefined;
    act(() => {
      first = h.latest().approveStep("RUN-1044", "scope-review");
      second = h.latest().approveStep("RUN-1044", "scope-review");
    });

    // The first approval landed …
    expect(first?.ok).toBe(true);
    // … and the second is told the TRUTH, not a false success.
    expect(second?.ok).toBe(false);
    expect(second?.reason).toMatch(/not awaiting approval/i);

    // Committed state matches what each caller was told: the gate was approved
    // exactly ONCE (one approver stamped), and the run advanced past it a single
    // step — never twice.
    const run = h.latest().getRun("RUN-1044");
    const gate = run?.steps.find((s) => s.id === "scope-review");
    expect(gate?.status).toBe("done");
    expect(gate?.approvedBy).toBe("Sam Okafor");
    expect(run?.steps.find((s) => s.id === "provision")?.status).toBe(
      "running",
    );
  });
});
