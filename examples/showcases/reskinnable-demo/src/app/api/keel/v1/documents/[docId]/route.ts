import * as store from "@/skins/keel/data/store";
import { getDoc } from "@/skins/keel/knowledge/corpus";

/**
 * The per-document read that serves the parameterized route
 * `/<skin>/knowledge/<docId>`.
 *
 * It returns BOTH halves because a document at Harbor Point is both:
 *
 *  - `doc`    — the corpus entry: title, ref, owner, and the anchored sections a
 *               citation deep-links into. Static prose, from `knowledge/corpus.ts`.
 *  - `record` — the register row: status, review dates, attestation coverage,
 *               the effective revision, the revision awaiting release, and beat
 *               5's flag / notices / notes. Mutable, from the store.
 *
 * Joined HERE rather than by the page, so the two can never be fetched a moment
 * apart, and so the register cannot drift into carrying its own copy of the
 * prose.
 *
 * A record with no corpus entry is a 404 rather than a half-answer: the page's
 * whole job is to render the document, and `{ doc: null }` would have every
 * consumer inventing its own empty state. A corpus doc with no REGISTER row is
 * NOT a 404 — the prose is the primary artifact and the lifecycle overlay is
 * additive, so `record` is simply `null` and the page renders the text without
 * the register strip. (`register-seed.test.ts` fails if that case ever arises
 * from the seed, so a null `record` in practice means somebody added a corpus
 * document without an overlay.)
 */
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) => {
  const { docId } = await params;
  const doc = getDoc(docId);
  if (!doc) {
    return Response.json(
      { error: "NOT_FOUND", message: "That document is not in the library." },
      { status: 404 },
    );
  }
  return Response.json({ doc, record: store.findDocument(docId) ?? null });
};
