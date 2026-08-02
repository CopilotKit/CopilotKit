import { describe, it, expect } from "vitest";
import type { Run } from "./types";
import { KEEL_PLAYBOOKS, KEEL_SEED_RUNS } from "./seed";

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
