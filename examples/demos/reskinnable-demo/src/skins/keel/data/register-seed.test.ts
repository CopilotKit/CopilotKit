import { describe, it, expect } from "vitest";
import { KEEL_CORPUS } from "@/skins/keel/knowledge/corpus";
import { SEEDED_DOC_IDS, seedRegister } from "./register-seed";
import { attentionClasses, coverageStatus } from "./attention";
import { missingEndorsements } from "./attention";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const seed = () => seedRegister(NOW);

describe("the register derives from the corpus and cannot drift from it", () => {
  it("covers every corpus document, and names no document the corpus lacks", () => {
    // The drift guard. Two hand-written lists with nothing comparing them is how
    // a register ends up citing a policy number the library does not carry —
    // which is the one failure this skin's whole credibility claim rests on.
    const corpusIds = KEEL_CORPUS.map((doc) => doc.id).sort();
    expect([...SEEDED_DOC_IDS].sort()).toEqual(corpusIds);
    expect(
      seed()
        .map((r) => r.docId)
        .sort(),
    ).toEqual(corpusIds);
  });

  it("copies ref, title, space and owner off the corpus rather than restating them", () => {
    for (const record of seed()) {
      const doc = KEEL_CORPUS.find((d) => d.id === record.docId);
      expect(doc).toBeDefined();
      expect(record.ref).toBe(doc?.ref);
      expect(record.title).toBe(doc?.title);
      expect(record.space).toBe(doc?.space);
      expect(record.owner).toBe(doc?.owner);
    }
  });
});

describe("the seed is arranged so every lever value leaves several rows", () => {
  // A too-thin seed makes a filter indistinguishable from a broken filter on
  // stage. These counts are the reason the seed looks the way it does, so they
  // are asserted rather than left as a comment that nothing checks.
  it("splits the corpus 3/3/3 across the spaces", () => {
    const records = seed();
    for (const space of ["privacy", "clinical", "vendor"] as const) {
      expect(records.filter((r) => r.space === space)).toHaveLength(3);
    }
  });

  it("leaves at least two rows for every attention class", () => {
    const records = seed();
    const count = (cls: string) =>
      records.filter((r) => attentionClasses(r, NOW).includes(cls as never))
        .length;
    expect(count("review_overdue")).toBeGreaterThanOrEqual(3);
    expect(count("attestation_short")).toBeGreaterThanOrEqual(3);
    expect(count("unendorsed_revision")).toBe(2);
  });

  it("seeds exactly one document whose attestation coverage is UNMEASURABLE", () => {
    // The reachable "unknown" case attention.ts exists for. Without it the
    // tri-state is untested by the thing it was built for.
    const unknown = seed().filter((r) => coverageStatus(r) === "unknown");
    expect(unknown.map((r) => r.ref)).toEqual(["POL-311"]);
    expect(unknown[0].effectiveRevision).toBeUndefined();
  });
});

describe("the three pending revisions", () => {
  it("seeds TWO gated cases, so the taught case and the replayed case differ", () => {
    const gated = seed().filter((r) => missingEndorsements(r).length > 0);
    expect(
      gated.map((r) => `${r.ref} ${r.pendingRevision?.label}`).sort(),
    ).toEqual(["POL-114 Rev D", "POL-208 Rev C"]);
    for (const record of gated) {
      expect(missingEndorsements(record)).toEqual([
        "Policy Governance Committee",
      ]);
    }
  });

  it("seeds ONE fully endorsed revision for beat 3a to countersign", () => {
    // Beat 3a's card must offer an act the operator is ALREADY authorized to
    // take. Without this row the PIN would have to release something the gate
    // refuses, which is a second door around beat 6 and kills the teach arc
    // silently. Losing it is therefore a demo failure with no other symptom.
    const clear = seed().filter(
      (r) => r.pendingRevision && missingEndorsements(r).length === 0,
    );
    expect(clear.map((r) => r.ref)).toEqual(["STD-045"]);
    expect(clear[0].pendingRevision?.label).toBe("Rev B");
  });

  it("carries no active variance on any seeded revision", () => {
    // A seeded variance would be an unlock nobody filed — beat 6 would open
    // already taught, everything would still work, and it would prove nothing.
    for (const record of seed()) {
      expect(record.pendingRevision?.activeVarianceId).toBeUndefined();
    }
  });
});

describe("dates are anchored to the build, never to a calendar constant", () => {
  it("re-anchors on every call so a long-lived server does not drift overdue", () => {
    const later = seedRegister(NOW + 400 * 86_400_000);
    const early = seed();
    const overdueNow = early.filter((r) => r.reviewDue < "2026-06-01").length;
    const overdueLater = later.filter(
      (r) =>
        r.reviewDue <
        new Date(NOW + 400 * 86_400_000).toISOString().slice(0, 10),
    ).length;
    expect(overdueLater).toBe(overdueNow);
  });

  it("emits ISO dates, not timestamps, for the two review fields", () => {
    for (const record of seed()) {
      expect(record.reviewDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
