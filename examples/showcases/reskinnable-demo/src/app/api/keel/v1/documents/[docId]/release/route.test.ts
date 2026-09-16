import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import { VARIANCE_CODES, isJustifying } from "@/skins/keel/data/variance-codes";
import { gatedRevisions } from "@/skins/keel/data/release-authority";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

const call = (docId: string, body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ docId }) },
  );

/**
 * The cases are DISCOVERED from the live register rather than hardcoded. A seed
 * change that unblocks a case would otherwise turn every assertion below vacuous
 * while leaving the suite green — the exact shape of a guard that passes for the
 * wrong reason.
 */
const gatedDocIds = (): string[] =>
  gatedRevisions(store.documents(), store.variances()).map(
    (c) => c.record.docId,
  );

const aGatedDocId = (): string => {
  const [first] = gatedDocIds();
  if (!first) throw new Error("the seed must carry a gated revision");
  return first;
};

const anEndorsedDocId = (): string => {
  const doc = store
    .documents()
    .find((r) => r.pendingRevision && !gatedDocIds().includes(r.docId));
  if (!doc) throw new Error("the seed must carry a fully endorsed revision");
  return doc.docId;
};

const justifying = () => {
  const code = VARIANCE_CODES.find(isJustifying);
  if (!code) throw new Error("the catalogue must contain a justifying code");
  return code;
};
const decoy = () => {
  const code = VARIANCE_CODES.find((c) => !isJustifying(c));
  if (!code) throw new Error("the catalogue must contain a decoy");
  return code;
};

describe("BEAT 6 — the gate refuses, with symptoms only", () => {
  it("refuses an unendorsed revision with 403 UNENDORSED_REVISION", async () => {
    const docId = aGatedDocId();
    const res = await call(docId, { personaId: SAM.id });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("UNENDORSED_REVISION");
    // The write did NOT land — a refusal that mutated anything would be theater.
    expect(store.findDocument(docId)?.pendingRevision).toBeDefined();
  });

  it("states the SYMPTOM — the ref, the revision and who has not signed", async () => {
    // Asserting presence as well as absence: an empty message would satisfy
    // "does not name a code" and tell the operator nothing.
    const docId = aGatedDocId();
    const record = store.findDocument(docId);
    const body = await (await call(docId, { personaId: SAM.id })).json();
    expect(body.message).toContain(record?.ref);
    expect(body.message).toContain(record?.pendingRevision?.label);
    expect(body.missing).toEqual(["Policy Governance Committee"]);
  });

  it("names NO part of the fix — no variance, no code, no catalogue", async () => {
    const body = await (
      await call(aGatedDocId(), { personaId: SAM.id })
    ).json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/variance|waiver|override|exception/i);
    for (const code of VARIANCE_CODES) expect(text).not.toContain(code);
  });
});

describe("BEAT 6 — the unlock path", () => {
  it("still refuses after a ratified DECOY variance", async () => {
    // The decoy files honestly, records in the register, and lifts nothing. The
    // release staying blocked is the demonstration working, not failing.
    const docId = aGatedDocId();
    const variance = store.fileVariance(
      docId,
      decoy(),
      "committee is out",
      SAM,
    );
    store.ratifyVariance(variance.id);
    const res = await call(docId, { personaId: SAM.id });
    expect(res.status).toBe(403);
    expect(store.findDocument(docId)?.pendingRevision).toBeDefined();
  });

  it("still refuses under a justifying variance that was never ratified", async () => {
    const docId = aGatedDocId();
    store.fileVariance(docId, justifying(), "safety alert", SAM);
    expect((await call(docId, { personaId: SAM.id })).status).toBe(403);
  });

  it("RELEASES under a ratified JUSTIFYING variance, and the write lands", async () => {
    const docId = aGatedDocId();
    const record = store.findDocument(docId);
    const label = record?.pendingRevision?.label;
    const variance = store.fileVariance(
      docId,
      justifying(),
      "safety alert",
      SAM,
    );
    store.ratifyVariance(variance.id);

    const res = await call(docId, { personaId: SAM.id });
    expect(res.status).toBe(200);
    expect((await res.json()).via).toBe("variance");

    // Re-READ the record: a 200 is not the proof, the committed change is.
    const after = store.findDocument(docId);
    expect(after?.effectiveRevision).toBe(label);
    expect(after?.pendingRevision).toBeUndefined();
    expect(after?.releases?.[0]).toMatchObject({
      via: "variance",
      varianceId: variance.id,
      releasedBy: SAM.name,
    });
  });

  it("leaves the OTHER gated case still blocked — the unaided replay", async () => {
    // Two seeded cases exist precisely so the case taught on stage and the case
    // replayed unaided are different records.
    const [first, second] = gatedDocIds();
    expect(second).toBeDefined();
    const variance = store.fileVariance(
      first,
      justifying(),
      "safety alert",
      SAM,
    );
    store.ratifyVariance(variance.id);
    await call(first, { personaId: SAM.id });
    expect((await call(second, { personaId: SAM.id })).status).toBe(403);
  });
});

describe("the ungated path and the ordinary refusals", () => {
  it("releases a fully endorsed revision with no variance at all", async () => {
    const docId = anEndorsedDocId();
    const res = await call(docId, { personaId: SAM.id });
    expect(res.status).toBe(200);
    expect((await res.json()).via).toBe("endorsed");
    expect(store.findDocument(docId)?.pendingRevision).toBeUndefined();
  });

  it("derives releasedBy from the persona and never from the body", async () => {
    const docId = anEndorsedDocId();
    await call(docId, { personaId: SAM.id, releasedBy: "Somebody Else" });
    expect(store.findDocument(docId)?.releases?.[0].releasedBy).toBe(SAM.name);
  });

  it("400s an unknown persona", async () => {
    expect(
      (await call(anEndorsedDocId(), { personaId: "nobody" })).status,
    ).toBe(400);
  });

  it("400s a body that is not JSON at all", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "not json" }),
      { params: Promise.resolve({ docId: anEndorsedDocId() }) },
    );
    expect(res.status).toBe(400);
  });

  it("404s a document that is not in the register", async () => {
    expect((await call("no-such-doc", { personaId: SAM.id })).status).toBe(404);
  });

  it("409s — not 403 — a document with nothing waiting to be released", async () => {
    // Answering with the gate's own code would teach an operator to file a
    // variance against a revision that does not exist.
    const res = await call("breach-response", { personaId: SAM.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("NO_PENDING_REVISION");
  });
});
