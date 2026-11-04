import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import { gatedRevisions } from "@/skins/keel/data/release-authority";
import { VARIANCE_CODES, isJustifying } from "@/skins/keel/data/variance-codes";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

/** A PIN that `readSigningPin` accepts — six digits, nothing else. */
const VALID_PIN = "482913";

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

/**
 * Both cases are DISCOVERED from the live register, never hardcoded. A seed
 * change that endorsed the gated revision, or un-endorsed the clear one, would
 * otherwise leave every assertion below passing for the wrong reason.
 */
const gatedDocIds = () =>
  gatedRevisions(store.documents(), store.variances()).map(
    (c) => c.record.docId,
  );

const gatedRef = (): string => {
  const [docId] = gatedDocIds();
  const record = docId ? store.findDocument(docId) : undefined;
  if (!record) throw new Error("the seed must carry a gated revision");
  return record.ref;
};

const endorsedRecord = () => {
  const record = store
    .documents()
    .find((r) => r.pendingRevision && !gatedDocIds().includes(r.docId));
  if (!record) throw new Error("the seed must carry a fully endorsed revision");
  return record;
};

describe("BEAT 3a — the PIN releases what the operator may already release", () => {
  it("releases a fully endorsed revision and commits the write", async () => {
    const record = endorsedRecord();
    const label = record.pendingRevision?.label;
    const res = await call({
      document: record.ref,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(200);
    // Re-READ: the 200 is not the proof, the committed change is.
    const after = store.findDocument(record.docId);
    expect(after?.effectiveRevision).toBe(label);
    expect(after?.pendingRevision).toBeUndefined();
    expect(after?.releases?.[0].releasedBy).toBe(SAM.name);
  });

  it("accepts the human-facing ref and the docId alike", async () => {
    const record = endorsedRecord();
    const res = await call({
      document: record.docId,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(200);
  });
});

/**
 * ⚠️ THE TEST THIS FILE EXISTS FOR.
 *
 * Beat 3a wants a control the operator types a secret into. Beat 6 wants a gate
 * the agent cannot clear until it has watched the operator clear it once. In
 * this skin they touch the SAME write, and the cheapest way to build 3a is to
 * let the PIN release the thing the gate is refusing. Do that and beat 6 is
 * dead: the agent has a second door, it never has to learn the procedure, the
 * teach arc never fires, and NOTHING FAILS. The app compiles, the card is
 * gorgeous, the write lands, the room applauds.
 *
 * A second factor confirms WHO is acting. It never changes WHAT they may
 * release. Deleting the `checkReleaseAuthority` call in this route turns exactly
 * these assertions red and leaves every other test in the tree green — which is
 * the only symptom this failure has.
 */
describe("BEAT 3a is NOT a way past BEAT 6's gate", () => {
  it("REFUSES a valid PIN on an unendorsed revision, with the gate's own error", async () => {
    const ref = gatedRef();
    const res = await call({
      document: ref,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("UNENDORSED_REVISION");
    expect(store.findDocumentByRef(ref)?.pendingRevision).toBeDefined();
  });

  it("REFUSES a valid PIN even after a ratified DECOY variance", async () => {
    const ref = gatedRef();
    const record = store.findDocumentByRef(ref);
    const code = VARIANCE_CODES.find((c) => !isJustifying(c));
    if (!record || !code) throw new Error("need a gated case and a decoy");
    const variance = store.fileVariance(
      record.docId,
      code,
      "committee is out",
      SAM,
    );
    store.ratifyVariance(variance.id);
    expect(
      (await call({ document: ref, pin: VALID_PIN, personaId: SAM.id })).status,
    ).toBe(403);
  });

  it("says what the unlock IS: a ratified justifying variance lifts the same block", async () => {
    // The companion assertion — without it this suite only says what the PIN is
    // NOT, and a route that refused everything would pass.
    const ref = gatedRef();
    const record = store.findDocumentByRef(ref);
    const code = VARIANCE_CODES.find(isJustifying);
    if (!record || !code)
      throw new Error("need a gated case and a justifying code");
    const variance = store.fileVariance(
      record.docId,
      code,
      "safety alert",
      SAM,
    );
    store.ratifyVariance(variance.id);
    const res = await call({
      document: ref,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).via).toBe("variance");
  });

  it("takes NO revision parameter — the agent names the record, never the revision", async () => {
    // If the caller could choose which revision to release, the agent could
    // choose an unendorsed one and the PIN would be doing the gate's job again.
    const record = endorsedRecord();
    const gated = store.findDocumentByRef(gatedRef());
    const res = await call({
      document: record.ref,
      revision: gated?.pendingRevision?.label,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(200);
    // The unrelated gated document is untouched by the extra parameter.
    expect(store.findDocument(gated!.docId)?.pendingRevision).toBeDefined();
  });
});

describe("the PIN never leaves the card, and never comes back", () => {
  it("401s an unreadable PIN without echoing what was typed", async () => {
    for (const pin of ["", "4829", "-482913", "48291a", null, 482913]) {
      const res = await call({
        document: endorsedRecord().ref,
        pin,
        personaId: SAM.id,
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("INVALID_PIN");
      expect(JSON.stringify(body)).not.toContain("482913");
      expect(JSON.stringify(body)).not.toContain("4829");
    }
  });

  it("does not echo the PIN on a SUCCESSFUL release either", async () => {
    const res = await call({
      document: endorsedRecord().ref,
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(JSON.stringify(await res.json())).not.toContain(VALID_PIN);
  });

  it("checks the PIN BEFORE consulting the register", async () => {
    // The 404 and 409 below are ANSWERS: they tell an unauthenticated caller
    // which documents exist and which have a revision waiting. Refusing an
    // unreadable request first means those answers are never given away.
    const res = await call({
      document: "POL-999",
      pin: "nope",
      personaId: SAM.id,
    });
    expect(res.status).toBe(401);
  });
});

describe("ordinary refusals", () => {
  it("400s a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s an unknown persona", async () => {
    const res = await call({
      document: endorsedRecord().ref,
      pin: VALID_PIN,
      personaId: "nobody",
    });
    expect(res.status).toBe(400);
  });

  it("404s a document that is not in the register", async () => {
    const res = await call({
      document: "POL-999",
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(404);
  });

  it("409s a document with nothing waiting to be released", async () => {
    const res = await call({
      document: "POL-121",
      pin: VALID_PIN,
      personaId: SAM.id,
    });
    expect(res.status).toBe(409);
  });
});
