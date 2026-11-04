import { beforeEach, describe, expect, it } from "vitest";
import { POST as fileBrief } from "@/app/api/keel/v1/briefs/route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import {
  BULLETIN_THEMES,
  freshCitationFor,
} from "@/skins/keel/data/bulletin-citations";
import { buildOpsReportOps } from "@/skins/keel/ops-report";
import type { ImpactBrief } from "@/skins/keel/data/types";
import {
  buildImpactBriefOps,
  IMPACT_BRIEF_SURFACE_ID,
  renderImpactBriefParams,
} from "./impact-brief-ops";
import type { BriefCitationRow } from "./impact-brief-ops";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");

type Component = { id: string; component: string } & Record<string, unknown>;

const componentsOf = (
  ops: ReturnType<typeof buildImpactBriefOps>,
): Component[] => {
  const op = ops.find((candidate) => "updateComponents" in candidate);
  if (!op) throw new Error("the op list carries no updateComponents");
  return (op.updateComponents as { components: Component[] }).components;
};

const component = (
  ops: ReturnType<typeof buildImpactBriefOps>,
  id: string,
): Component => {
  const found = componentsOf(ops).find((c) => c.id === id);
  if (!found) throw new Error(`no component "${id}" in the op list`);
  return found;
};

const rowsOf = (ops: ReturnType<typeof buildImpactBriefOps>) =>
  component(ops, "brief-citations").rows as BriefCitationRow[];

/**
 * The bulletin the demo actually attaches, rebuilt exactly the way
 * `GET /api/keel/v1/bulletin?space=privacy` builds it — carried documents out of
 * the live register, plus the one ref the register does not hold.
 *
 * Rebuilt rather than mocked so the test breaks if the route and this diverge
 * about what the privacy bulletin says.
 */
const privacyBulletinCitations = () => {
  const theme = BULLETIN_THEMES.get("privacy");
  if (!theme) throw new Error("the corpus lost the privacy space");
  const carried = store
    .documents()
    .filter((record) => record.space === "privacy")
    .map((record, index) => ({
      ref: record.ref,
      title: record.title,
      requiredAction:
        theme.requirements[index % theme.requirements.length] ?? "",
    }));
  const fresh = freshCitationFor("privacy", store.refsOnFile());
  return { carried, fresh };
};

/** File the brief through the real route, as the agent's tool would. */
const fileFromBulletin = async (
  citations: { ref: string; title: string; requiredAction: string }[],
) => {
  const res = await fileBrief(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({
        source: "Northeast Health Information Authority",
        space: "privacy",
        effective: "1 October 2026",
        summary:
          "Refreshed expectations for governing access to protected health " +
          "information.",
        citations,
        impacts: ["Assess each listed document", "Record the assessment"],
        personaId: SAM.id,
      }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as {
    brief: ImpactBrief;
    settled: string[];
    unmatched: string[];
  };
};

/**
 * ⚠️ THE BEAT'S ONLY PROOF.
 *
 * A brief that could have been assembled out of `GET /ledger` alone proves
 * nothing: the model can list the register's own documents without ever opening
 * the attachment, and the artifact reads perfectly either way. What it cannot do
 * without reading the file is name POL-118 — a policy the bulletin cites and the
 * library does not carry — or state the required action the ISSUING BODY wrote.
 *
 * These tests join the two halves the beat needs: something only the bulletin
 * knows (the uncarried ref and its required action) sitting next to something
 * only the register knows (the revision currently in force for the documents it
 * does carry), on one canvas.
 */
describe("the filed brief carries a fact the register could not have supplied", () => {
  it("marks the bulletin's uncarried ref as absent from the library", async () => {
    const { carried, fresh } = privacyBulletinCitations();
    expect(fresh).toBeDefined();
    if (!fresh) return;

    // The premise: the register genuinely does not hold this ref, so no read of
    // `GET /ledger` could have produced it.
    expect(store.findDocumentByRef(fresh.ref)).toBeUndefined();

    const { brief, settled, unmatched } = await fileFromBulletin([
      ...carried,
      fresh,
    ]);
    expect(unmatched).toEqual([fresh.ref]);
    expect(settled).toEqual(carried.map((c) => c.ref));

    const rows = rowsOf(buildImpactBriefOps(brief, store.refsOnFile()));
    const uncarried = rows.filter((row) => !row.carried);
    expect(uncarried).toHaveLength(1);
    expect(uncarried[0].ref).toBe(fresh.ref);
    // The bulletin's own sentence, verbatim on the canvas. Nothing in the
    // register holds this text — that is what makes it evidence.
    expect(uncarried[0].requiredAction).toBe(fresh.requiredAction);
    expect(uncarried[0].currentRevision).toBeUndefined();
  });

  it("holds no document whose record could have supplied that required action", () => {
    const fresh = freshCitationFor("privacy", store.refsOnFile());
    expect(fresh).toBeDefined();
    if (!fresh) return;

    // Stated as an assertion rather than as a comment: if a later seed ever
    // writes the bulletin's sentence onto a register record, the row stops being
    // proof of anything and this test says so.
    const haystack = JSON.stringify(store.documents());
    expect(haystack).not.toContain(fresh.requiredAction);
    expect(haystack).not.toContain(fresh.ref);
  });

  it("joins it to a REGISTER fact the bulletin never printed", async () => {
    const { carried, fresh } = privacyBulletinCitations();
    if (!fresh) throw new Error("the privacy bulletin lost its fresh citation");

    const { brief } = await fileFromBulletin([...carried, fresh]);
    const rows = rowsOf(buildImpactBriefOps(brief, store.refsOnFile()));

    // The bulletin deliberately prints NO revision label (see
    // `data/bulletin-pdf.ts`), so every revision on this canvas was settled from
    // the register by `POST /briefs`. One canvas, both halves.
    const pol114 = rows.find((row) => row.ref === "POL-114");
    expect(pol114?.carried).toBe(true);
    expect(pol114?.currentRevision).toBe(
      store.findDocumentByRef("POL-114")?.effectiveRevision,
    );
    expect(pol114?.currentRevision).toBeTruthy();
  });

  it("re-derives carried-ness against the LIVE register, not against filing time", async () => {
    const { carried, fresh } = privacyBulletinCitations();
    if (!fresh) throw new Error("the privacy bulletin lost its fresh citation");
    const { brief } = await fileFromBulletin([...carried, fresh]);

    // A register that has come to carry the ref makes the row ordinary. The
    // claim "the library does not hold this" is about the register NOW.
    const rows = rowsOf(
      buildImpactBriefOps(brief, [...store.refsOnFile(), fresh.ref]),
    );
    expect(rows.find((row) => row.ref === fresh.ref)?.carried).toBe(true);
  });

  it("matches carried-ness on the canonical ref, so a respelled ref still counts", async () => {
    const { brief } = await fileFromBulletin([
      { ref: "POL-114", title: "PHI access", requiredAction: "Recertify" },
    ]);
    // `POST /briefs` rewrites a matched ref to the register's spelling, so feed
    // the builder a register that spells it differently instead.
    const rows = rowsOf(buildImpactBriefOps(brief, ["pol 114"]));
    expect(rows[0].carried).toBe(true);
  });
});

describe("buildImpactBriefOps", () => {
  const brief = (over: Partial<ImpactBrief> = {}): ImpactBrief => ({
    id: "brief-1",
    source: "Northeast Health Information Authority",
    space: "privacy",
    effective: "1 October 2026",
    summary: "Refreshed expectations.",
    citations: [
      {
        ref: "POL-114",
        title: "PHI Access & Minimum Necessary",
        currentRevision: "Rev C",
        requiredAction: "State the review interval in the document itself.",
      },
    ],
    impacts: ["Assess each listed document"],
    filedBy: SAM.name,
    role: SAM.role,
    createdAt: "2026-08-12T09:00:00.000Z",
    ...over,
  });

  it("emits createSurface + updateComponents under its own surface id", () => {
    const ops = buildImpactBriefOps(brief(), store.refsOnFile());
    expect(ops).toHaveLength(2);
    expect(ops[0].createSurface).toMatchObject({
      surfaceId: IMPACT_BRIEF_SURFACE_ID,
    });
    expect((ops[1].updateComponents as { surfaceId: string }).surfaceId).toBe(
      IMPACT_BRIEF_SURFACE_ID,
    );
  });

  it("does NOT share the operations report's surface id", () => {
    // One a2ui provider keeps one surface per id, so sharing would make a filed
    // brief overwrite an ops report the presenter is still looking at.
    const reportSurface = (
      buildOpsReportOps({ title: "Ops", kpis: [], charts: [] })[0]
        .createSurface as { surfaceId: string }
    ).surfaceId;
    expect(IMPACT_BRIEF_SURFACE_ID).not.toBe(reportSurface);
  });

  it("names the SAME catalog the operations report names", () => {
    // `REPORT_CATALOG_ID` is private to ops-report.ts, so this is the only place
    // the two spellings can be held together. One provider serves both surfaces;
    // a drifted catalogId renders nothing and says nothing.
    const reportCatalogId = (
      buildOpsReportOps({ title: "Ops", kpis: [], charts: [] })[0]
        .createSurface as { catalogId: string }
    ).catalogId;
    const briefCatalogId = (
      buildImpactBriefOps(brief(), store.refsOnFile())[0].createSurface as {
        catalogId: string;
      }
    ).catalogId;
    expect(briefCatalogId).toBe(reportCatalogId);
  });

  it("roots a Stack whose children are the sections it emitted, in order", () => {
    const ops = buildImpactBriefOps(brief(), store.refsOnFile());
    const root = componentsOf(ops)[0];
    expect(root.id).toBe("root");
    expect(root.children).toEqual([
      "heading",
      "brief-meta",
      "brief-summary",
      "brief-citations",
      "brief-impacts",
    ]);
  });

  it("carries the record's provenance verbatim, including the effective date", () => {
    const ops = buildImpactBriefOps(
      brief({ effective: "1 October 2026", createdAt: "2026-08-12T09:00:00Z" }),
      store.refsOnFile(),
    );
    expect(component(ops, "brief-meta")).toMatchObject({
      source: "Northeast Health Information Authority",
      space: "privacy",
      effective: "1 October 2026",
      filedBy: SAM.name,
      role: SAM.role,
      filedAt: "2026-08-12T09:00:00Z",
    });
  });

  it("drops the impacts section when the brief has none", () => {
    const ops = buildImpactBriefOps(brief({ impacts: [] }), store.refsOnFile());
    expect(componentsOf(ops).some((c) => c.id === "brief-impacts")).toBe(false);
    expect(componentsOf(ops)[0].children).not.toContain("brief-impacts");
  });

  it("omits currentRevision rather than emitting undefined for a never-released document", () => {
    const ops = buildImpactBriefOps(
      brief({
        citations: [
          {
            ref: "POL-311",
            title: "Vendor Offboarding",
            requiredAction: "Record the evidence retained.",
          },
        ],
      }),
      store.refsOnFile(),
    );
    const [row] = rowsOf(ops);
    // Carried by the register, but never released — a different fact from "the
    // library does not hold it", and the renderer says so.
    expect(row.carried).toBe(true);
    expect("currentRevision" in row).toBe(false);
  });
});

describe("renderImpactBriefParams", () => {
  it("takes the brief id and nothing else", () => {
    // Every other value on the canvas is read from the filed record. A second
    // parameter here would be a second telling of the brief, free to disagree
    // with the durable one.
    expect(Object.keys(renderImpactBriefParams.shape)).toEqual(["briefId"]);
    expect(renderImpactBriefParams.parse({ briefId: "brief-1" })).toEqual({
      briefId: "brief-1",
    });
  });
});
