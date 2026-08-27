import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { POST as RATIFY } from "./[id]/ratify/route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import { VARIANCE_CODES, isJustifying } from "@/skins/keel/data/variance-codes";
import { gatedRevisions } from "@/skins/keel/data/release-authority";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

const file = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const ratify = (id: string) =>
  RATIFY(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

const gatedDocId = (): string => {
  const [first] = gatedRevisions(store.documents(), store.variances());
  if (!first) throw new Error("the seed must carry a gated revision");
  return first.record.docId;
};

const justifying = () => VARIANCE_CODES.find(isJustifying)!;
const decoy = () => VARIANCE_CODES.find((c) => !isJustifying(c))!;

describe("POST /variances", () => {
  it("files a draft against the revision that is actually waiting", async () => {
    const docId = gatedDocId();
    const res = await file({
      docId,
      code: justifying(),
      rationale: "safety alert",
      personaId: SAM.id,
    });
    expect(res.status).toBe(201);
    const variance = await res.json();
    expect(variance).toMatchObject({
      status: "draft",
      revision: store.findDocument(docId)?.pendingRevision?.label,
      filedBy: SAM.name,
      role: SAM.role,
    });
  });

  it("files a DECOY exactly as readily — the register stays honest", async () => {
    const res = await file({
      docId: gatedDocId(),
      code: decoy(),
      rationale: "committee is out",
      personaId: SAM.id,
    });
    expect(res.status).toBe(201);
  });

  it("derives filedBy from the persona and never from the body", async () => {
    const res = await file({
      docId: gatedDocId(),
      code: justifying(),
      rationale: "x",
      personaId: SAM.id,
      filedBy: "Somebody Else",
    });
    expect((await res.json()).filedBy).toBe(SAM.name);
  });
});

/**
 * ⚠️ THE WITHHOLDING TEST. This is the one place in the app where the rule
 * "enumerate every closed set so the vocabulary reaches the model" is INVERTED:
 * for beat 6's gate, the vocabulary reaching the model IS the defect. An agent
 * that can read the valid values out of a refusal brute-forces the gate, never
 * has to be taught anything, and the demo proves nothing while looking perfect.
 */
describe("an uncatalogued code is refused WITHOUT enumerating the catalogue", () => {
  it("422s and echoes only what the caller sent", async () => {
    const res = await file({
      docId: gatedDocId(),
      code: "CEO_APPROVED",
      rationale: "x",
      personaId: SAM.id,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("UNKNOWN_VARIANCE_CODE");
    expect(body.message).toContain("CEO_APPROVED");
    for (const code of VARIANCE_CODES) {
      expect(JSON.stringify(body)).not.toContain(code);
    }
  });

  it("says nothing about which codes justify, on ANY refusal path", async () => {
    for (const body of [
      {
        docId: gatedDocId(),
        code: "URGENT",
        rationale: "x",
        personaId: SAM.id,
      },
      { docId: "no-such-doc", code: justifying(), personaId: SAM.id },
      { docId: "breach-response", code: justifying(), personaId: SAM.id },
    ]) {
      const text = JSON.stringify(await (await file(body)).json());
      for (const code of VARIANCE_CODES) expect(text).not.toContain(code);
      expect(text).not.toMatch(/justif|valid codes|catalogue/i);
    }
  });
});

describe("the ordinary refusals", () => {
  it("400s a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s an unknown persona", async () => {
    const res = await file({
      docId: gatedDocId(),
      code: justifying(),
      personaId: "x",
    });
    expect(res.status).toBe(400);
  });

  it("404s a document that is not in the register", async () => {
    const res = await file({
      docId: "nope",
      code: justifying(),
      personaId: SAM.id,
    });
    expect(res.status).toBe(404);
  });

  it("409s a document with no revision awaiting release", async () => {
    const res = await file({
      docId: "breach-response",
      code: justifying(),
      personaId: SAM.id,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("NO_PENDING_REVISION");
  });
});

describe("POST /variances/[id]/ratify", () => {
  it("ratifies a draft and links it to the pending revision", async () => {
    const docId = gatedDocId();
    const variance = await (
      await file({
        docId,
        code: justifying(),
        rationale: "x",
        personaId: SAM.id,
      })
    ).json();
    const res = await ratify(variance.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ratified");
    expect(store.findDocument(docId)?.pendingRevision?.activeVarianceId).toBe(
      variance.id,
    );
  });

  it("says nothing about whether the variance will actually unlock anything", async () => {
    // It cannot: that would publish the justifying/decoy split, which is exactly
    // what is being withheld.
    const docId = gatedDocId();
    const variance = await (
      await file({ docId, code: decoy(), rationale: "x", personaId: SAM.id })
    ).json();
    const body = await (await ratify(variance.id)).json();
    expect(JSON.stringify(body)).not.toMatch(/justif|unlock|will not|lifts/i);
  });

  it("404s an unknown variance and 409s a second ratification", async () => {
    expect((await ratify("var-nope")).status).toBe(404);
    const variance = await (
      await file({
        docId: gatedDocId(),
        code: justifying(),
        rationale: "x",
        personaId: SAM.id,
      })
    ).json();
    expect((await ratify(variance.id)).status).toBe(200);
    expect((await ratify(variance.id)).status).toBe(409);
  });
});

describe("GET /variances", () => {
  it("starts empty and lists what was filed", async () => {
    expect(await (await GET()).json()).toEqual([]);
    await file({
      docId: gatedDocId(),
      code: justifying(),
      rationale: "x",
      personaId: SAM.id,
    });
    expect(await (await GET()).json()).toHaveLength(1);
  });
});
