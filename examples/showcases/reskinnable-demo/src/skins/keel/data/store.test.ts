import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";
import { NOTE_MARKER } from "./handling";
import { getPersona } from "./personas";
import { VARIANCE_CODES, isJustifying } from "./variance-codes";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

describe("reads", () => {
  it("serves the whole register and the four seeded runs", () => {
    expect(store.documents()).toHaveLength(9);
    expect(store.runs().map((r) => r.id)).toEqual([
      "RUN-1041",
      "RUN-1042",
      "RUN-1043",
      "RUN-1044",
    ]);
    expect(store.playbooks()).toHaveLength(4);
  });

  it("starts with no variances and no impact briefs, and never will", () => {
    // A seeded variance is an unlock nobody filed; a seeded brief is an artifact
    // with no document behind it. Both would leave their beat proving nothing.
    expect(store.variances()).toEqual([]);
    expect(store.impactBriefs()).toEqual([]);
  });

  it("finds a document by ref however the model spelled it", () => {
    // The ref arrives from a model that read it off a PDF. An exact === would
    // call "pol-114" a stranger and silently turn a policy the library HAS
    // carried for years into "not in the library".
    for (const spelling of [
      "POL-114",
      "pol-114",
      "POL 114",
      " POL-114 ",
      "POL114",
    ]) {
      expect(store.findDocumentByRef(spelling)?.docId).toBe(
        "phi-access-policy",
      );
    }
    expect(store.findDocumentByRef("POL-999")).toBeUndefined();
  });

  it("lists every ref on file", () => {
    expect(store.refsOnFile()).toContain("POL-114");
    expect(store.refsOnFile()).toHaveLength(9);
  });
});

describe("beat 5's three writes all land on ONE record", () => {
  it("raises a review flag and derives who raised it from the caller", () => {
    const record = store.raiseReviewFlag(
      "breach-response",
      "review-overdue",
      SAM.name,
    );
    expect(record.reviewFlag).toMatchObject({
      reason: "review-overdue",
      raisedBy: SAM.name,
    });
  });

  it("refuses a reason outside the closed set", () => {
    expect(() =>
      store.raiseReviewFlag("breach-response", "just-because", SAM.name),
    ).toThrow("INVALID_REVIEW_REASON");
  });

  it("copies the owning department off the RECORD, not the caller", () => {
    const notice = store.sendOwnerNotice(
      "breach-response",
      "review-due",
      SAM.name,
    );
    expect(notice.owner).toBe(store.findDocument("breach-response")?.owner);
    expect(notice.sentBy).toBe(SAM.name);
  });

  it("refuses a template outside the closed set", () => {
    expect(() =>
      store.sendOwnerNotice("breach-response", "shouting", SAM.name),
    ).toThrow("INVALID_NOTICE");
  });

  it("FORCES the marker onto a note the model phrased politely", () => {
    const note = store.addDocumentNote(
      "breach-response",
      "Past due.",
      SAM.name,
    );
    expect(note.text.startsWith(NOTE_MARKER)).toBe(true);
  });

  it("does not double the marker on a note that already carries one", () => {
    const note = store.addDocumentNote(
      "breach-response",
      `${NOTE_MARKER} Past due.`,
      SAM.name,
    );
    expect(note.text.match(/🚨/g)).toHaveLength(1);
  });

  it("refuses an empty note", () => {
    expect(() =>
      store.addDocumentNote("breach-response", "   ", SAM.name),
    ).toThrow("EMPTY_NOTE");
  });

  it("keeps notices and notes newest first", () => {
    store.addDocumentNote("breach-response", "first", SAM.name);
    store.addDocumentNote("breach-response", "second", SAM.name);
    expect(store.findDocument("breach-response")?.notes?.[0].text).toContain(
      "second",
    );
  });

  it("404s on a document that is not in the register", () => {
    expect(() =>
      store.raiseReviewFlag("nope", "review-overdue", SAM.name),
    ).toThrow("NOT_FOUND");
    expect(() => store.sendOwnerNotice("nope", "review-due", SAM.name)).toThrow(
      "NOT_FOUND",
    );
    expect(() => store.addDocumentNote("nope", "x", SAM.name)).toThrow(
      "NOT_FOUND",
    );
  });
});

describe("variances", () => {
  const justifying = VARIANCE_CODES.find(isJustifying)!;
  const decoy = VARIANCE_CODES.find((c) => !isJustifying(c))!;

  it("files a draft against the revision that is actually waiting", () => {
    const v = store.fileVariance(
      "phi-access-policy",
      justifying,
      "because",
      SAM,
    );
    expect(v).toMatchObject({
      status: "draft",
      revision: "Rev D",
      filedBy: SAM.name,
      role: SAM.role,
    });
  });

  it("files a DECOY exactly as readily as a justifying code", () => {
    // The register stays honest; the gate is what tells them apart.
    expect(
      store.fileVariance("phi-access-policy", decoy, "because", SAM).code,
    ).toBe(decoy);
  });

  it("refuses an uncatalogued code", () => {
    expect(() =>
      store.fileVariance("phi-access-policy", "URGENT", "because", SAM),
    ).toThrow("INVALID_VARIANCE_CODE");
  });

  it("refuses a document with no revision waiting", () => {
    expect(() =>
      store.fileVariance("breach-response", justifying, "because", SAM),
    ).toThrow("NO_PENDING_REVISION");
  });

  it("links a ratified variance onto the pending revision", () => {
    const v = store.fileVariance(
      "phi-access-policy",
      justifying,
      "because",
      SAM,
    );
    store.ratifyVariance(v.id);
    expect(
      store.findDocument("phi-access-policy")?.pendingRevision
        ?.activeVarianceId,
    ).toBe(v.id);
    expect(store.findVariance(v.id)?.ratifiedAt).toBeTruthy();
  });

  it("links a ratified DECOY the same way — it just lifts nothing", () => {
    const v = store.fileVariance("phi-access-policy", decoy, "because", SAM);
    store.ratifyVariance(v.id);
    expect(
      store.findDocument("phi-access-policy")?.pendingRevision
        ?.activeVarianceId,
    ).toBe(v.id);
  });

  it("refuses to ratify twice", () => {
    const v = store.fileVariance(
      "phi-access-policy",
      justifying,
      "because",
      SAM,
    );
    store.ratifyVariance(v.id);
    expect(() => store.ratifyVariance(v.id)).toThrow("ALREADY_RATIFIED");
  });

  it("refuses to ratify a variance that does not exist", () => {
    expect(() => store.ratifyVariance("var-nope")).toThrow("NOT_FOUND");
  });
});

describe("releaseRevision commits the change the room has to SEE", () => {
  it("promotes the pending revision, clears it, and files a receipt", () => {
    const before = store.findDocument("third-party-risk");
    expect(before?.effectiveRevision).toBe("Rev A");
    const after = store.releaseRevision(
      "third-party-risk",
      "Lin Whitaker",
      "endorsed",
    );
    expect(after.effectiveRevision).toBe("Rev B");
    // Cleared, or the register would still say "Rev B awaiting release" after
    // releasing Rev B and nobody could tell whether anything happened.
    expect(after.pendingRevision).toBeUndefined();
    expect(after.status).toBe("published");
    expect(after.releases?.[0]).toMatchObject({
      revision: "Rev B",
      releasedBy: "Lin Whitaker",
      via: "endorsed",
    });
  });

  it("records the variance id when it cleared by variance", () => {
    const after = store.releaseRevision(
      "phi-access-policy",
      "Sam Okafor",
      "variance",
      "var-9",
    );
    expect(after.releases?.[0]).toMatchObject({
      via: "variance",
      varianceId: "var-9",
    });
  });

  it("resets the review clock forward", () => {
    const after = store.releaseRevision(
      "third-party-risk",
      "Lin Whitaker",
      "endorsed",
    );
    expect(after.reviewDue > after.lastReviewed).toBe(true);
  });

  it("refuses a document with no revision waiting", () => {
    expect(() =>
      store.releaseRevision("breach-response", "x", "endorsed"),
    ).toThrow("NO_PENDING_REVISION");
  });
});

describe("runs go through the SAME pure engine the client hook uses", () => {
  it("starts a run and puts it at the head of the list", () => {
    const result = store.startRun(
      "phi-access-contractor",
      { subject: "Priya Raman" },
      "Ana Reyes",
    );
    expect(result.ok).toBe(true);
    expect(store.runs()[0].id).toBe(result.run?.id);
    expect(store.runs()[0].requestedBy).toBe("Ana Reyes");
  });

  it("refuses an unknown playbook without mutating anything", () => {
    const before = store.runs().length;
    expect(store.startRun("nope", { subject: "x" }, "Ana Reyes").ok).toBe(
      false,
    );
    expect(store.runs()).toHaveLength(before);
  });

  it("lets the role named by the gate approve, and nobody else", () => {
    // RUN-1044 is blocked at `scope-review`, which requires a Privacy Officer.
    const wrong = store.approveStep("RUN-1044", "scope-review", "ana-reyes");
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toContain("Privacy Officer");
    const right = store.approveStep("RUN-1044", "scope-review", "sam-okafor");
    expect(right.ok).toBe(true);
    expect(store.findRun("RUN-1044")?.status).not.toBe("blocked");
  });

  it("records a rejection as rejectedBy and NEVER as approvedBy", () => {
    const result = store.rejectStep(
      "RUN-1044",
      "scope-review",
      "sam-okafor",
      "no",
    );
    expect(result.ok).toBe(true);
    const step = store
      .findRun("RUN-1044")
      ?.steps.find((s) => s.id === "scope-review");
    expect(step?.rejectedBy).toBe("Sam Okafor");
    expect(step?.approvedBy).toBeUndefined();
    expect(store.findRun("RUN-1044")?.status).toBe("cancelled");
  });

  it("cancels a live run and refuses to cancel it twice", () => {
    expect(store.cancelRun("RUN-1044").ok).toBe(true);
    expect(store.cancelRun("RUN-1044").ok).toBe(false);
  });

  it("refuses a run that does not exist", () => {
    expect(store.cancelRun("RUN-9999").ok).toBe(false);
    expect(store.approveStep("RUN-9999", "x", "sam-okafor").ok).toBe(false);
  });
});

describe("reset puts the desk back to the state the demo starts from", () => {
  it("drops beat 5's three writes, which live ON the record", () => {
    store.raiseReviewFlag("breach-response", "review-overdue", SAM.name);
    store.sendOwnerNotice("breach-response", "review-due", SAM.name);
    store.addDocumentNote("breach-response", "chased", SAM.name);
    store.reset();
    const record = store.findDocument("breach-response");
    expect(record?.reviewFlag).toBeUndefined();
    expect(record?.ownerNotices).toBeUndefined();
    expect(record?.notes).toBeUndefined();
  });

  it("empties the variances, so beat 6 does not open already unlocked", () => {
    const v = store.fileVariance(
      "phi-access-policy",
      VARIANCE_CODES[0],
      "x",
      SAM,
    );
    store.ratifyVariance(v.id);
    store.reset();
    expect(store.variances()).toEqual([]);
    expect(
      store.findDocument("phi-access-policy")?.pendingRevision
        ?.activeVarianceId,
    ).toBeUndefined();
  });

  it("restores a released revision to awaiting-release", () => {
    store.releaseRevision("third-party-risk", "Lin Whitaker", "endorsed");
    store.reset();
    const record = store.findDocument("third-party-risk");
    expect(record?.effectiveRevision).toBe("Rev A");
    expect(record?.pendingRevision?.label).toBe("Rev B");
    expect(record?.releases).toBeUndefined();
  });

  it("empties beat 3d's artifacts and restores the runs", () => {
    store.fileImpactBrief({
      source: "State Department of Health",
      space: "privacy",
      effective: "1 July 2026",
      summary: "s",
      citations: [],
      impacts: [],
      filedBy: SAM.name,
      role: SAM.role,
    });
    store.startRun("phi-access-contractor", { subject: "x" }, SAM.name);
    store.reset();
    expect(store.impactBriefs()).toEqual([]);
    expect(store.runs()).toHaveLength(4);
  });
});

describe("fileImpactBrief", () => {
  it("files newest first and stamps an id and a time", () => {
    const first = store.fileImpactBrief({
      source: "A",
      space: "privacy",
      effective: "x",
      summary: "s",
      citations: [],
      impacts: [],
      filedBy: SAM.name,
      role: SAM.role,
    });
    const second = store.fileImpactBrief({
      source: "B",
      space: "vendor",
      effective: "x",
      summary: "s",
      citations: [],
      impacts: [],
      filedBy: SAM.name,
      role: SAM.role,
    });
    expect(store.impactBriefs().map((b) => b.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(first.createdAt).toBeTruthy();
  });
});
