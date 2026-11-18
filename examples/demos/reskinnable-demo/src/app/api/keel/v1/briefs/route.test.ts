import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST } from "./route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

const file = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const bulletin = (citations: unknown[]) => ({
  source: "State Department of Health",
  space: "privacy",
  effective: "1 July 2026",
  summary: "Tightens contractor access recertification.",
  citations,
  impacts: ["Recertify contractor accounts", "Re-run the access audit"],
  personaId: SAM.id,
});

/**
 * ⚠️ BEAT 3d's LAST FAILURE POINT — an optional field the model fills in when it
 * should not have.
 *
 * The lesson comes from logistics: an optional `oldRateUsdPerKg` documented as
 * "omit for a new lane", which the agent filled with the QUOTED rate, so the
 * artifact rendered "flat" for the one row the attached document printed as new
 * service. The record contradicted the document it was filed from, on exactly
 * the row that proves the document was read. And the field goes wrong in THREE
 * directions, not one: over-filled, under-filled and simply wrong, all three
 * putting the same lie on the same row.
 *
 * The fix is not prompt wording. It is splitting the fields by WHO OWNS THE FACT
 * and letting the server settle its own, in every direction — which is what
 * these four tests pin.
 */
describe("POST /briefs settles the REGISTER's fields in every direction", () => {
  it("OVERWRITES a wrong currentRevision from the register", async () => {
    const res = await file(
      bulletin([
        {
          ref: "POL-114",
          title: "Whatever the bulletin called it",
          currentRevision: "Rev Z",
          requiredAction: "Recertify quarterly",
        },
      ]),
    );
    expect(res.status).toBe(201);
    const { brief, settled, unmatched } = await res.json();
    expect(settled).toEqual(["POL-114"]);
    expect(unmatched).toEqual([]);
    expect(brief.citations[0].currentRevision).toBe(
      store.findDocumentByRef("POL-114")?.effectiveRevision,
    );
  });

  it("FILLS IN a currentRevision the model omitted", async () => {
    const { brief } = await (
      await file(
        bulletin([
          { ref: "POL-114", title: "PHI access", requiredAction: "Recertify" },
        ]),
      )
    ).json();
    expect(brief.citations[0].currentRevision).toBe("Rev C");
  });

  it("DROPS a currentRevision for a ref the library does not carry", async () => {
    // Absence of the row IS the answer. A revision label beside a ref the
    // library does not hold asserts a document Harbor Point does not have — and
    // this is the row that proves the file was read, so it is the one the model
    // is most likely to over-fill.
    const { brief, settled, unmatched } = await (
      await file(
        bulletin([
          {
            ref: "POL-118",
            title: "Patient Right of Access",
            currentRevision: "Rev A",
            requiredAction: "Adopt within 90 days",
          },
        ]),
      )
    ).json();
    expect(unmatched).toEqual(["POL-118"]);
    expect(settled).toEqual([]);
    expect(brief.citations[0]).not.toHaveProperty("currentRevision");
    // The model's own reading of the ref and the action SURVIVES — that half is
    // the beat's proof and is not the server's to overrule.
    expect(brief.citations[0].requiredAction).toBe("Adopt within 90 days");
    expect(brief.citations[0].title).toBe("Patient Right of Access");
  });

  it("leaves currentRevision ABSENT for a document never released", async () => {
    // `??` is not settlement: it would repair the under-filled case and store
    // the wrong one. POL-311 is in the register with no effective revision, so
    // the honest answer is no field at all.
    const { brief, settled } = await (
      await file(
        bulletin([
          {
            ref: "POL-311",
            title: "Procurement",
            currentRevision: "Rev Q",
            requiredAction: "Note",
          },
        ]),
      )
    ).json();
    expect(settled).toEqual(["POL-311"]);
    expect(brief.citations[0]).not.toHaveProperty("currentRevision");
  });

  it("reports BOTH lists so the tool can tell the agent rather than overrule it", async () => {
    const { settled, unmatched } = await (
      await file(
        bulletin([
          { ref: "pol 114", title: "x", requiredAction: "a" },
          { ref: "POL-118", title: "y", requiredAction: "b" },
          { ref: "STD-045", title: "z", requiredAction: "c" },
        ]),
      )
    ).json();
    // Matched however the bulletin spelled it, and reported in the REGISTER's
    // spelling so the artifact and the register pages agree.
    expect(settled).toEqual(["POL-114", "STD-045"]);
    expect(unmatched).toEqual(["POL-118"]);
  });

  it("takes the register's own title on a match", async () => {
    const { brief } = await (
      await file(
        bulletin([
          { ref: "POL-114", title: "the PHI one", requiredAction: "a" },
        ]),
      )
    ).json();
    expect(brief.citations[0].title).toBe(
      store.findDocumentByRef("POL-114")?.title,
    );
  });
});

describe("the artifact belongs to the application", () => {
  it("carries the document's effective date across VERBATIM", async () => {
    const { brief } = await (await file(bulletin([]))).json();
    expect(brief.effective).toBe("1 July 2026");
  });

  it("derives filedBy and role from the persona", async () => {
    const { brief } = await (await file(bulletin([]))).json();
    expect(brief.filedBy).toBe(SAM.name);
    expect(brief.role).toBe(SAM.role);
  });

  it("caps the impacts at three", async () => {
    const { brief } = await (
      await file({ ...bulletin([]), impacts: ["a", "b", "c", "d", "e"] })
    ).json();
    expect(brief.impacts).toEqual(["a", "b", "c"]);
  });

  it("survives in the store and lists newest first", async () => {
    await file(bulletin([]));
    await file({ ...bulletin([]), source: "The accreditor" });
    const briefs = await (await GET()).json();
    expect(briefs).toHaveLength(2);
    expect(briefs[0].source).toBe("The accreditor");
  });
});

describe("refusals", () => {
  it("400s a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s an unknown persona, a missing source and a missing summary", async () => {
    expect((await file({ ...bulletin([]), personaId: "x" })).status).toBe(400);
    expect((await file({ ...bulletin([]), source: "  " })).status).toBe(400);
    expect((await file({ ...bulletin([]), summary: "" })).status).toBe(400);
  });

  it("422s a space the corpus does not have, and names the valid ones", async () => {
    const res = await file({ ...bulletin([]), space: "finance" });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("privacy");
  });

  it("files nothing on a refusal", async () => {
    await file({ ...bulletin([]), space: "finance" });
    expect(store.impactBriefs()).toEqual([]);
  });
});
