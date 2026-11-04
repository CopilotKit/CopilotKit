import * as store from "@/skins/keel/data/store";
import { buildBulletinPdf } from "@/skins/keel/data/bulletin-pdf";
import {
  BULLETIN_THEMES,
  freshCitationFor,
} from "@/skins/keel/data/bulletin-citations";
import type { BulletinCitation } from "@/skins/keel/data/bulletin-citations";
import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";

/**
 * BEAT 3d — serves the regulatory bulletin the demo attaches.
 *
 * Generated per request from the live register, so the policies it cites are the
 * policies the Register page shows and the effective date is always a sensible
 * number of days out. See `data/bulletin-pdf.ts` for why this is not a static
 * file in `public/`.
 *
 * EVERY LISTED DOCUMENT IS SCOPED TO THE SPACE REQUESTED, and the one row that
 * cannot be (the uncarried ref the beat needs) is per-space and re-checked
 * against the live register — see `data/bulletin-citations.ts`. The model lifts
 * facts out of this document and narrates them as fact, so a privacy bulletin
 * citing a clinical policy number is the app manufacturing a regulatory claim
 * and then asserting it on stage.
 */
const DEFAULT_SPACE: KnowledgeSpace = "privacy";

/** How far out the bulletin's requirements take effect. */
const EFFECTIVE_IN_DAYS = 45;
const DAY_MS = 86_400_000;

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Resolves the `space` lever, treating an absent value and an unusable one as
 * the same request.
 *
 * `searchParams.get("space") ?? DEFAULT_SPACE` would be wrong: `??` only falls
 * back on nullish, but `?space=` — the shape a cleared field produces — yields
 * the EMPTY STRING, so the default would never apply and the route would 404 on
 * a space nobody named. Downstream, `stageAttachment` (`@/shell/attach`) maps
 * the non-2xx to `staged === false`, which ABORTS the pill — so the beat does
 * not run at all, and the only clue to why is whatever this route left in the
 * log.
 */
const requestedSpace = (url: string): string =>
  new URL(url).searchParams.get("space")?.trim().toLowerCase() || DEFAULT_SPACE;

/**
 * Why the WHOLE body is inside the `try`.
 *
 * This route is beat 3d's document source and the only place a failure here can
 * be diagnosed. A non-2xx aborts the pill and alerts the presenter, so the beat
 * fails loudly rather than sending "read the attached bulletin" with no file
 * attached (which would leave the model to invent the document's contents and
 * the demo to prove the exact opposite of its point). But the alert can only say
 * "HTTP 500 — see the server logs". Three distinct throw sites live in here:
 * `new URL(...)` before any PDF work, `buildBulletinPdf` itself, and the
 * `Response` constructor, whose `content-disposition` interpolates the resolved
 * space.
 */
export const GET = async (req: Request) => {
  // Hoisted out of the `try` only so the `catch` can name the space: it is the
  // one request-varying input, and therefore the only thing that distinguishes
  // one failing request from another in the log.
  let space: string = DEFAULT_SPACE;
  try {
    space = requestedSpace(req.url);
    const theme = BULLETIN_THEMES.get(space as KnowledgeSpace);
    if (!theme) {
      // A space rename in the corpus is otherwise an INVISIBLE way to disable
      // beat 3d: the pill fetches this route with no `space` at all, so
      // `DEFAULT_SPACE` stops matching and the abort chain above fires with only
      // "HTTP 404" to show for it. `console.warn`, not `console.error`: this is
      // a deliberate domain answer, not a fault.
      console.warn(
        `[keel/api] GET bulletin?space=${space} — the corpus has no such ` +
          `space; spaces on file: ${[...BULLETIN_THEMES.keys()].join(", ")}`,
      );
      return Response.json(
        { error: "NOT_FOUND", message: "That is not a corpus space." },
        { status: 404 },
      );
    }
    const scoped = space as KnowledgeSpace;

    // The documents the register genuinely holds for this space. Read live, so a
    // bulletin never cites a ref a reseed removed.
    const carried: BulletinCitation[] = store
      .documents()
      .filter((record) => record.space === scoped)
      .map((record, index) => ({
        ref: record.ref,
        // The bulletin's shorthand is the register's own title. The bulletin is
        // external and would plausibly abbreviate, but an abbreviation is a
        // second spelling of a document the desk already names — and the agent
        // would then file a citation the Register page cannot be pointed at.
        title: record.title,
        requiredAction:
          theme.requirements[index % theme.requirements.length] ?? "",
      }));

    // The one row the register cannot supply — the whole reason a filed brief
    // can be told apart from one assembled out of `GET /ledger`. Dropped rather
    // than misattributed when a reseed adds the ref; see `bulletin-citations.ts`.
    const fresh = freshCitationFor(scoped, store.refsOnFile());
    const citations = fresh ? [...carried, fresh] : carried;

    const pdf = buildBulletinPdf({
      source: theme.source,
      scope: theme.scope,
      effective: LONG_DATE.format(
        new Date(Date.now() + EFFECTIVE_IN_DAYS * DAY_MS),
      ),
      summary: theme.summary,
      citations,
    });

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="bulletin-${scoped}.pdf"`,
        // Never cache: the effective date is computed from `now`, and a cached
        // copy would quietly go stale in exactly the way a static file would.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[keel/api] GET bulletin?space=${space} failed:`, error);
    return Response.json(
      { error: "SERVER_ERROR", message: "Could not build the bulletin." },
      { status: 500 },
    );
  }
};
