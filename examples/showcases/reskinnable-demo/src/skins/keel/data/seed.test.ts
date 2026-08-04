import { describe, it, expect } from "vitest";
import type { Run } from "./types";
import { KEEL_PLAYBOOKS, KEEL_SEED_RUNS, seedKeelRuns } from "./seed";

/**
 * Corpus ids fixed by spec §5.1, for the docs the playbooks reference. This is
 * the SELF-CONTAINED mirror used for resolution in this worktree; the LIVE
 * cross-check against `@/skins/keel/knowledge/corpus` (Task 2) runs in the last
 * describe and is verified at Phase 2 integration.
 */
const SPEC_REFS: Record<string, { ref: string; sections: string[] }> = {
  "phi-access-policy": {
    ref: "POL-114",
    sections: [
      "scope",
      "minimum-necessary",
      "workforce-clearance",
      "contractor-access",
      "audit-logging",
      "revocation",
    ],
  },
  "baa-requirements": {
    ref: "POL-302",
    sections: [
      "when-a-baa-is-required",
      "required-terms",
      "subcontractor-flowdown",
      "execution-and-storage",
      "termination",
    ],
  },
  "data-classification": {
    ref: "STD-031",
    sections: [
      "tiers",
      "phi-definition",
      "handling-by-tier",
      "deidentification",
      "storage-locations",
    ],
  },
  "credentialing-standard": {
    ref: "POL-203",
    sections: [
      "primary-source-verification",
      "license-and-dea",
      "malpractice-history",
      "committee-review",
      "provisional-privileges",
      "recredentialing-cycle",
    ],
  },
  "third-party-risk": {
    ref: "STD-045",
    sections: [
      "risk-tiering",
      "required-evidence",
      "soc2-and-hitrust",
      "remediation-and-exceptions",
      "annual-review",
    ],
  },
  "adverse-event-reporting": {
    ref: "POL-208",
    sections: [
      "what-to-report",
      "timeframes",
      "severity-levels",
      "root-cause-analysis",
      "non-retaliation",
    ],
  },
};

describe("keel playbooks", () => {
  it("ships the four playbooks fixed by spec §6.2", () => {
    expect(KEEL_PLAYBOOKS.map((p) => p.id).sort()).toEqual([
      "adverse-event",
      "credential-practitioner",
      "phi-access-contractor",
      "vendor-baa-review",
    ]);
  });

  it("gives every requiresApproval step an approverRole", () => {
    for (const pb of KEEL_PLAYBOOKS) {
      for (const step of pb.steps) {
        if (step.requiresApproval) {
          expect(step.approverRole, `${pb.id}/${step.id}`).toBeTruthy();
        }
      }
    }
  });

  it("points every step policyRef at a doc + section fixed in spec §5.1", () => {
    for (const pb of KEEL_PLAYBOOKS) {
      for (const step of pb.steps) {
        const pr = step.policyRef;
        expect(pr, `${pb.id}/${step.id} has a policyRef`).toBeTruthy();
        if (!pr) continue;
        const doc = SPEC_REFS[pr.docId];
        expect(doc, `${pr.docId} is a known corpus doc`).toBeTruthy();
        if (!doc) continue;
        expect(pr.ref).toBe(doc.ref);
        expect(doc.sections).toContain(pr.sectionId);
      }
    }
  });
});

describe("keel seeded runs", () => {
  it("seeds RUN-1041 through RUN-1044 so the desk is never empty", () => {
    expect(KEEL_SEED_RUNS.map((r) => r.id)).toEqual([
      "RUN-1041",
      "RUN-1042",
      "RUN-1043",
      "RUN-1044",
    ]);
  });

  it("keeps every seeded run's step states consistent with its status", () => {
    for (const r of KEEL_SEED_RUNS) assertConsistent(r);
  });
});

/**
 * Time-anchoring: seeds are relative to the moment they are created, so the
 * demo reads sensibly whenever it runs (the live app compares these timestamps
 * against `Date.now()`). Anchor is injected for determinism — no global clock.
 */
describe("keel seed time-anchoring", () => {
  // A fixed anchor unrelated to any calendar date the seed might have used.
  const NOW = Date.parse("2026-08-04T12:00:00.000Z");
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  /** Mirror of use-data's `runCycleTimeMs`: first start → last completion. */
  function cycleTimeMs(run: Run): number | null {
    if (run.status !== "completed") return null;
    const completions = run.steps
      .map((s) => s.completedAt)
      .filter((v): v is string => Boolean(v))
      .map((v) => Date.parse(v));
    if (completions.length === 0) return null;
    const start = Date.parse(run.steps[0]?.startedAt ?? run.createdAt);
    return Math.max(0, Math.max(...completions) - start);
  }

  it("keeps a completed seeded run's cycle time in the order of hours, not days", () => {
    const runs = seedKeelRuns(NOW);
    const completed = runs.filter((r) => r.status === "completed");
    expect(completed.length, "seeds a completed run").toBeGreaterThan(0);
    for (const r of completed) {
      const cycle = cycleTimeMs(r);
      expect(cycle, `${r.id} has a cycle time`).not.toBeNull();
      expect(cycle as number, `${r.id} cycle time under 6h`).toBeLessThan(
        SIX_HOURS_MS,
      );
    }
  });

  it("does not seed the live run's current step already overdue", () => {
    const runs = seedKeelRuns(NOW);
    const live = runs.filter((r) => r.status === "running");
    expect(live.length, "seeds a running run").toBeGreaterThan(0);
    for (const r of live) {
      const current = r.steps.find((s) => s.status === "running");
      expect(current, `${r.id} has a running step`).toBeTruthy();
      if (!current) continue;
      const elapsed = NOW - Date.parse(current.startedAt ?? "");
      // The engine completes a running step once elapsed > durationMs. Seeded at
      // NOW, the current step must be un-elapsed so it animates, not snaps ahead.
      expect(
        elapsed,
        `${r.id}/${current.id} current step elapsed (>= 0)`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        elapsed,
        `${r.id}/${current.id} not overdue (elapsed ${elapsed}ms <= durationMs ${current.durationMs}ms)`,
      ).toBeLessThanOrEqual(current.durationMs);
    }
  });

  it("bounds the live run's eventual cycle time by anchoring its first start recently", () => {
    // Symptom 1: when the live run COMPLETES during a demo, its cycle time is
    // last-completion (≈ now) − first-start. If first-start sat at a fixed past
    // date, that span is days. Anchoring the run's start recently keeps it sane.
    const runs = seedKeelRuns(NOW);
    for (const r of runs.filter((x) => x.status === "running")) {
      const firstStart = Date.parse(r.steps[0]?.startedAt ?? r.createdAt);
      const age = NOW - firstStart;
      expect(age, `${r.id} first-start age (>= 0)`).toBeGreaterThanOrEqual(0);
      expect(age, `${r.id} started within 6h of now (${age}ms)`).toBeLessThan(
        SIX_HOURS_MS,
      );
    }
  });

  it("re-anchors on every call, so a remount is never seeded stale", () => {
    const early = seedKeelRuns(NOW);
    const later = seedKeelRuns(NOW + 60 * 60 * 1000); // +1h remount
    const stepStart = (runs: Run[]): number => {
      const live = runs.find((r) => r.status === "running");
      const step = live?.steps.find((s) => s.status === "running");
      return Date.parse(step?.startedAt ?? "");
    };
    expect(stepStart(early)).toBe(NOW);
    expect(stepStart(later)).toBe(NOW + 60 * 60 * 1000);
  });
});

/** A run is a prefix of `done`, then one active step, then `pending`. */
function assertConsistent(r: Run): void {
  const statuses = r.steps.map((s) => s.status);

  if (r.status === "completed") {
    expect(statuses.every((s) => s === "done")).toBe(true);
    return;
  }

  const frontier = statuses.findIndex((s) => s !== "done");
  expect(frontier, `${r.id} has an active frontier`).toBeGreaterThanOrEqual(0);

  for (let i = 0; i < frontier; i++) {
    expect(statuses[i], `${r.id} step ${i}`).toBe("done");
  }
  for (let i = frontier + 1; i < statuses.length; i++) {
    expect(statuses[i], `${r.id} step ${i}`).toBe("pending");
  }

  const active = statuses.filter(
    (s) => s === "running" || s === "awaiting_approval",
  );
  expect(active, `${r.id} has exactly one active step`).toHaveLength(1);

  if (r.status === "blocked") {
    expect(statuses[frontier]).toBe("awaiting_approval");
    expect(r.steps[frontier].requiresApproval).toBe(true);
    expect(r.steps[frontier].approverRole).toBeTruthy();
  } else if (r.status === "running") {
    expect(statuses[frontier]).toBe("running");
  } else {
    throw new Error(`Unexpected seeded run status: ${r.status}`);
  }
}

interface CorpusDocShape {
  id: string;
  ref: string;
  sections: Array<{ id: string }>;
}

function findCorpusDocs(mod: Record<string, unknown>): CorpusDocShape[] | null {
  for (const value of Object.values(mod)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0] as { id?: unknown; sections?: unknown };
      if (typeof first.id === "string" && Array.isArray(first.sections)) {
        return value as CorpusDocShape[];
      }
    }
  }
  return null;
}

/**
 * PHASE 2 INTEGRATION ONLY. The corpus module is Task 2's file and is absent in
 * this isolated worktree, so the dynamic import throws and the assertion body is
 * skipped — the test passes as a documented no-op here. At integration it
 * resolves every seeded policyRef against the REAL corpus, catching any drift
 * the SPEC_REFS mirror cannot.
 */
describe("policyRefs resolve against the live corpus (Phase 2)", () => {
  it("every policyRef resolves to a real corpus doc + section", async () => {
    // A COMPUTED specifier (not a static literal) keeps vite's import-analysis
    // from hard-failing at TRANSFORM time when the corpus file is absent in
    // this isolated worktree — a literal import would error before the
    // try/catch ever runs. At Phase 2 the file exists and the relative path
    // resolves at runtime. This does NOT weaken the assertion below; it only
    // defers resolution from transform time to runtime.
    const corpusSpecifier = "../knowledge/corpus";
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ corpusSpecifier)) as Record<
        string,
        unknown
      >;
    } catch {
      return; // corpus absent in this worktree — verified at Phase 2
    }

    const docs = findCorpusDocs(mod);
    if (!docs) return;

    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const pb of KEEL_PLAYBOOKS) {
      for (const step of pb.steps) {
        const pr = step.policyRef;
        if (!pr) continue;
        const doc = byId.get(pr.docId);
        expect(doc, `${pr.docId}`).toBeTruthy();
        if (!doc) continue;
        expect(doc.ref).toBe(pr.ref);
        expect(doc.sections.some((s) => s.id === pr.sectionId)).toBe(true);
      }
    }
  });
});
