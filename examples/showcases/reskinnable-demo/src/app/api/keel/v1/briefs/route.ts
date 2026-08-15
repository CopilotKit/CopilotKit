import * as store from "@/skins/keel/data/store";
import { findPersona } from "@/skins/keel/data/personas";
import type { ImpactBriefCitation } from "@/skins/keel/data/types";
import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";

const SPACES: readonly KnowledgeSpace[] = ["privacy", "clinical", "vendor"];

/**
 * BEAT 3d — file the durable Impact Brief from an ingested regulatory bulletin.
 *
 * ⚠️ THE FIELDS ARE SPLIT BY WHO OWNS THE FACT, and the server settles its own.
 *
 * This is the last place beat 3d can go wrong, and it goes wrong through a field
 * the model fills in when it should not have. Logistics shipped the worked
 * version of this defect: an optional `oldRateUsdPerKg` documented as "omit for a
 * new lane", which the agent filled with the QUOTED rate, so the artifact
 * rendered "flat" for the one row the attached document printed as new service —
 * the record contradicting the document it was filed from, on exactly the row
 * that proves the document was read. And screening the direction observed is not
 * enough: the same field goes wrong OVER-filled, UNDER-filled and simply WRONG,
 * and all three put the same lie on the same row. Prompt wording closes none of
 * them.
 *
 * So:
 *
 *  - `ref`, `title` and `requiredAction` stay MODEL-AUTHORED. Only a reader of
 *    the attachment knows them, and that is the beat's proof.
 *  - `currentRevision` is a REGISTER fact and is SETTLED here, in every
 *    direction: OVERWRITTEN from the register on a ref match (so a wrong reading
 *    cannot stand), and DROPPED when the library carries no such ref (so the
 *    absence of the row IS the answer, and an over-filled guess cannot claim the
 *    library carries a policy it does not). Note `??` is NOT settlement: it
 *    repairs the under-filled case and stores the wrong one.
 *  - `title` is overwritten too on a match — the register owns how a document it
 *    carries is named, and a bulletin's shorthand for POL-114 is not the title
 *    the desk's own pages print.
 *
 * The response returns BOTH lists so the tool can TELL the agent what was
 * settled rather than silently overruling it. A citation the register cannot
 * match is not an error: a bulletin naming a policy Harbor Point does not carry
 * is exactly the row the beat needs, and it is the honest answer to say so.
 */
export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json(
      { error: "BAD_REQUEST", message: "A JSON body is required." },
      { status: 400 },
    );
  }
  const { source, space, effective, summary, citations, impacts, personaId } =
    body as {
      source?: string;
      space?: string;
      effective?: string;
      summary?: string;
      citations?: ImpactBriefCitation[];
      impacts?: string[];
      personaId?: string;
    };

  const persona = personaId ? findPersona(personaId) : undefined;
  if (!persona) {
    return Response.json(
      { error: "BAD_REQUEST", message: "A known personaId is required." },
      { status: 400 },
    );
  }
  if (!source?.trim() || !summary?.trim()) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "A brief needs the issuing source and a summary.",
      },
      { status: 400 },
    );
  }
  if (!SPACES.includes(space as KnowledgeSpace)) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: `"${space}" is not a corpus space. Valid spaces: ${SPACES.join(", ")}.`,
      },
      { status: 422 },
    );
  }

  const settled: string[] = [];
  const unmatched: string[] = [];
  const resolved: ImpactBriefCitation[] = (citations ?? []).map((citation) => {
    // Rebuilt field by field rather than spread, so `currentRevision` can only
    // ever arrive from the register. Spreading the model's citation and adding
    // the field back conditionally settles ONLY the matched-and-released case: a
    // document the register carries but has NEVER released (POL-311) would keep
    // whatever revision the model wrote — the under-filled failure wearing the
    // matched case's clothes, with the artifact asserting a released revision
    // for a policy the workforce has never been given.
    const authored: ImpactBriefCitation = {
      ref: citation.ref,
      title: citation.title,
      requiredAction: citation.requiredAction,
    };
    const record = store.findDocumentByRef(citation.ref ?? "");
    if (!record) {
      unmatched.push(citation.ref);
      return authored;
    }
    settled.push(record.ref);
    return {
      ...authored,
      // The register's own spelling of the ref and the title, so the artifact
      // and the register pages name the same document the same way.
      ref: record.ref,
      title: record.title,
      // `effectiveRevision` is absent on a pure draft — spread conditionally so
      // the field is ABSENT rather than `undefined`, which is what the type
      // means by "the library carries no released revision".
      ...(record.effectiveRevision
        ? { currentRevision: record.effectiveRevision }
        : {}),
    };
  });

  const brief = store.fileImpactBrief({
    source: source.trim(),
    space: space as KnowledgeSpace,
    // Carried across VERBATIM: the effective date is a claim the document makes,
    // and normalizing it would be the app editing a regulator's statement.
    effective: (effective ?? "").trim(),
    summary: summary.trim(),
    citations: resolved,
    impacts: (impacts ?? []).slice(0, 3),
    filedBy: persona.name,
    role: persona.role,
  });

  return Response.json({ brief, settled, unmatched }, { status: 201 });
};

export const GET = async () => Response.json(store.impactBriefs());
