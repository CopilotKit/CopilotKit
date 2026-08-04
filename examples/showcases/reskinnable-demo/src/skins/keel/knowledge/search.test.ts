import { describe, it, expect } from "vitest";
import { getDoc, getDocsBySpace, KEEL_SPACES } from "./corpus";
import { searchCorpus, expandQuery } from "./search";

// The genuine knowledge query shared by spec §10 (pill "Contractor PHI access")
// and §11 beat 1. Its top hit must be POL-114 §contractor-access.
const CONTRACTOR_QUERY =
  "What's our policy on giving a contractor access to patient records?";

describe("searchCorpus", () => {
  it("returns POL-114 §contractor-access as the top hit for the demo query (§10/§11)", () => {
    const [top] = searchCorpus(CONTRACTOR_QUERY);
    expect(top).toBeDefined();
    expect(top.docId).toBe("phi-access-policy");
    expect(top.ref).toBe("POL-114");
    expect(top.sectionId).toBe("contractor-access");
    expect(top.heading).toBe("Contractor & Vendor Access");
  });

  it("returns [] for a nonsense query (below the score threshold)", () => {
    expect(searchCorpus("asdfghjkl qwertyuiop zxcvbnm")).toEqual([]);
  });

  it("is deterministic — repeated calls are byte-identical", () => {
    const a = searchCorpus(CONTRACTOR_QUERY);
    const b = searchCorpus(CONTRACTOR_QUERY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("breaks equal-score ties by ref then sectionId in code-point order (locale-independent)", () => {
    // "incident report" expands in a SINGLE non-transitive pass to
    // [incident, report, adverse, event, breach] (a synonym's own synonyms are
    // NOT pulled in), producing hits with deliberate score ties. The tiebreak
    // must be a fixed code-point order — identical on every host / ICU version /
    // locale — NOT locale collation, so the same passages come back in the same
    // order everywhere.
    const results = searchCorpus("incident report", { limit: 20 });
    const pos = (ref: string, sectionId: string) =>
      results.findIndex((c) => c.ref === ref && c.sectionId === sectionId);

    // Same ref (POL-208), same score (5): sectionId ascends by code point —
    // "root-cause-analysis" < "severity-levels" < "timeframes".
    const rca = pos("POL-208", "root-cause-analysis");
    const sev = pos("POL-208", "severity-levels");
    const tim = pos("POL-208", "timeframes");
    expect(rca).toBeGreaterThanOrEqual(0);
    expect(rca).toBeLessThan(sev);
    expect(sev).toBeLessThan(tim);

    // Cross ref, same score (2): ref ascends by code point — "POL-302" < "STD-045".
    const polTermination = pos("POL-302", "termination");
    const stdRequiredEvidence = pos("STD-045", "required-evidence");
    expect(polTermination).toBeGreaterThanOrEqual(0);
    expect(stdRequiredEvidence).toBeGreaterThanOrEqual(0);
    expect(polTermination).toBeLessThan(stdRequiredEvidence);
  });

  it("honors the space filter", () => {
    const results = searchCorpus("how do we credential a physician", {
      space: "clinical",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("credentialing-standard");
    // Every hit resolves to a clinical document — nothing leaked past the filter.
    for (const hit of results) {
      expect(getDoc(hit.docId)?.space).toBe("clinical");
    }
  });

  it("bounds the snippet length to ~200 characters", () => {
    for (const hit of searchCorpus(CONTRACTOR_QUERY)) {
      expect(hit.snippet.length).toBeGreaterThan(0);
      expect(hit.snippet.length).toBeLessThanOrEqual(210);
    }
  });

  it("respects the default limit of 4", () => {
    expect(searchCorpus(CONTRACTOR_QUERY).length).toBeLessThanOrEqual(4);
  });

  it("only expands a phrase synonym on a whole-words match, not a substring", () => {
    // "patient records" is a phrase synonym key expanding to PHI terms. A query
    // where it appears only as a substring of other words ("imPATIENT
    // RECORDSkeeping") must NOT pull in those PHI synonyms and broaden retrieval.
    const substringHits = searchCorpus("impatient recordskeeping workflow");
    for (const hit of substringHits) {
      expect(hit.docId).not.toBe("phi-access-policy");
    }

    // The genuine whole-words phrase still expands and surfaces POL-114.
    const phraseHits = searchCorpus("who may view patient records here");
    expect(phraseHits.some((h) => h.ref === "POL-114")).toBe(true);
  });
});

describe("expandQuery", () => {
  // "contractor" → ["workforce member", "vendor"] and "vendor" is itself a
  // synonym key → ["third party", "business associate"]. Expansion must be a
  // single pass over the original terms: "contractor" contributes "vendor", but
  // vendor's OWN synonyms (the second-order terms) must NOT be pulled in.
  it("does not chain expansion transitively through a synonym's own synonyms", () => {
    const terms = expandQuery("contractor");
    // Direct (first-order) synonyms of "contractor" are present.
    expect(terms).toEqual(
      expect.arrayContaining(["vendor", "workforce", "member"]),
    );
    // Second-order terms (vendor's expansions) must NOT appear.
    for (const secondOrder of ["third", "party", "business", "associate"]) {
      expect(terms).not.toContain(secondOrder);
    }
  });

  it("treats two synonym-bearing queries symmetrically, regardless of map order", () => {
    // "incident" → ["adverse event", "breach"]; "breach" → ["privacy incident"].
    // Both keys carry synonyms; in map order "incident" precedes "breach". A
    // single-pass expansion must treat them alike: neither query may inherit the
    // OTHER key's expansions just because of iteration order.
    const fromIncident = expandQuery("incident");
    const fromBreach = expandQuery("breach");

    // "incident" gets its own first-order synonyms, but NOT breach's expansion.
    expect(fromIncident).toEqual(
      expect.arrayContaining(["adverse", "event", "breach"]),
    );
    expect(fromIncident).not.toContain("privacy");

    // "breach" gets its own first-order synonym, but NOT incident's expansions.
    expect(fromBreach).toEqual(expect.arrayContaining(["privacy", "incident"]));
    expect(fromBreach).not.toContain("adverse");
    expect(fromBreach).not.toContain("event");
  });
});

describe("corpus helpers", () => {
  it("ships nine documents across the three spaces", () => {
    expect(getDocsBySpace("privacy")).toHaveLength(3);
    expect(getDocsBySpace("clinical")).toHaveLength(3);
    expect(getDocsBySpace("vendor")).toHaveLength(3);
  });

  it("exposes the three spaces with labels", () => {
    expect(KEEL_SPACES.map((s) => s.id)).toEqual([
      "privacy",
      "clinical",
      "vendor",
    ]);
    for (const space of KEEL_SPACES) {
      expect(space.label.length).toBeGreaterThan(0);
      expect(space.description.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known doc and returns undefined for an unknown id", () => {
    expect(getDoc("phi-access-policy")?.ref).toBe("POL-114");
    expect(getDoc("nope")).toBeUndefined();
  });
});
