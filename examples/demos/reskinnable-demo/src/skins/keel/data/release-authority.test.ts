import { describe, it, expect } from "vitest";
import { checkReleaseAuthority, gatedRevisions } from "./release-authority";
import { seedRegister } from "./register-seed";
import { VARIANCE_CODES, isJustifying } from "./variance-codes";
import type { DocumentRecord, Variance } from "./types";

const NOW = Date.parse("2026-06-01T12:00:00Z");

const registerBy = (ref: string): DocumentRecord => {
  const record = seedRegister(NOW).find((r) => r.ref === ref);
  if (!record) throw new Error(`no seeded document ${ref}`);
  return record;
};

/** The two tiers, DISCOVERED from the catalogue so a re-tiering cannot make these vacuous. */
const aJustifyingCode = () => {
  const code = VARIANCE_CODES.find(isJustifying);
  if (!code) throw new Error("the catalogue must contain a justifying code");
  return code;
};
const aDecoyCode = () => {
  const code = VARIANCE_CODES.find((c) => !isJustifying(c));
  if (!code) throw new Error("the catalogue must contain a decoy");
  return code;
};

const variance = (
  record: DocumentRecord,
  code: string,
  status: Variance["status"],
): Variance => ({
  id: "var-1",
  docId: record.docId,
  revision: record.pendingRevision?.label ?? "",
  code,
  status,
  rationale: "because",
  filedBy: "Sam Okafor",
  role: "Privacy Officer",
  createdAt: new Date(NOW).toISOString(),
  ...(status === "ratified" ? { ratifiedAt: new Date(NOW).toISOString() } : {}),
});

const linked = (record: DocumentRecord, v: Variance): DocumentRecord => ({
  ...record,
  pendingRevision: record.pendingRevision
    ? { ...record.pendingRevision, activeVarianceId: v.id }
    : undefined,
});

describe("the gate refuses with the SYMPTOM and never the fix", () => {
  const record = () => registerBy("POL-114");

  it("refuses an unendorsed revision", () => {
    const verdict = checkReleaseAuthority({ record: record(), variances: [] });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.code).toBe("UNENDORSED_REVISION");
    expect(verdict.missing).toEqual(["Policy Governance Committee"]);
  });

  it("names the document, the revision and the body that has not signed", () => {
    // Asserting the PRESENCE of the symptom as well as the absence of the fix.
    // An empty message satisfies "does not name a code" and would pass the
    // withholding check below while telling the operator nothing.
    const verdict = checkReleaseAuthority({ record: record(), variances: [] });
    if (verdict.allowed) throw new Error("expected a refusal");
    expect(verdict.message).toContain("POL-114");
    expect(verdict.message).toContain("Rev D");
    expect(verdict.message).toContain("Policy Governance Committee");
  });

  it("says NOTHING about variances, codes, or any way through", () => {
    const verdict = checkReleaseAuthority({ record: record(), variances: [] });
    if (verdict.allowed) throw new Error("expected a refusal");
    expect(verdict.message).not.toMatch(
      /variance|code|exception|override|waiver/i,
    );
    for (const code of VARIANCE_CODES) {
      expect(verdict.message).not.toContain(code);
    }
  });
});

describe("the unlock path", () => {
  it("allows a fully endorsed revision with no variance at all", () => {
    const verdict = checkReleaseAuthority({
      record: registerBy("STD-045"),
      variances: [],
    });
    expect(verdict).toEqual({ allowed: true, via: "endorsed" });
  });

  it("allows an unendorsed revision under a RATIFIED JUSTIFYING variance", () => {
    const record = registerBy("POL-114");
    const v = variance(record, aJustifyingCode(), "ratified");
    const verdict = checkReleaseAuthority({
      record: linked(record, v),
      variances: [v],
    });
    expect(verdict).toMatchObject({
      allowed: true,
      via: "variance",
      varianceId: v.id,
    });
  });

  it("REFUSES under a ratified DECOY — the demonstration working, not failing", () => {
    const record = registerBy("POL-114");
    const v = variance(record, aDecoyCode(), "ratified");
    const verdict = checkReleaseAuthority({
      record: linked(record, v),
      variances: [v],
    });
    expect(verdict.allowed).toBe(false);
  });

  it("REFUSES under a justifying variance that was never ratified", () => {
    const record = registerBy("POL-114");
    const v = variance(record, aJustifyingCode(), "draft");
    const verdict = checkReleaseAuthority({
      record: linked(record, v),
      variances: [v],
    });
    expect(verdict.allowed).toBe(false);
  });

  it("REFUSES when the linked variance id resolves to nothing", () => {
    const record = registerBy("POL-114");
    const v = variance(record, aJustifyingCode(), "ratified");
    const verdict = checkReleaseAuthority({
      record: linked(record, v),
      variances: [],
    });
    expect(verdict.allowed).toBe(false);
  });
});

describe("checkReleaseAuthority fails CLOSED with no pending revision", () => {
  it("does not report a document with nothing waiting as releasable", () => {
    const verdict = checkReleaseAuthority({
      record: registerBy("POL-121"),
      variances: [],
    });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.missing).toEqual([]);
  });
});

describe("gatedRevisions is the operator form's worklist", () => {
  it("runs the SAME check the route runs, so it cannot advertise a wrong case", () => {
    const cases = gatedRevisions(seedRegister(NOW), []);
    expect(cases.map((c) => `${c.record.ref} ${c.revision}`).sort()).toEqual([
      "POL-114 Rev D",
      "POL-208 Rev C",
    ]);
  });

  it("drops a case the demonstration has already unblocked", () => {
    // Leaving it on the list invites the presenter to demonstrate twice on the
    // same document, and the second demonstration proves nothing.
    const records = seedRegister(NOW);
    const target = records.find((r) => r.ref === "POL-114");
    if (!target) throw new Error("no POL-114");
    const v = variance(target, aJustifyingCode(), "ratified");
    const patched = records.map((r) =>
      r.ref === "POL-114" ? linked(r, v) : r,
    );
    expect(gatedRevisions(patched, [v]).map((c) => c.record.ref)).toEqual([
      "POL-208",
    ]);
  });

  it("ignores documents with no pending revision", () => {
    expect(
      gatedRevisions(
        seedRegister(NOW).filter((r) => !r.pendingRevision),
        [],
      ),
    ).toEqual([]);
  });
});
