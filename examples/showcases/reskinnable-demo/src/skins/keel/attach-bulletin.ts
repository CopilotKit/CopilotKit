/**
 * BEAT 3d for keel — the Northeast Health Information Authority's regulatory
 * bulletin, ingested by Harbor Point's document-control desk.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are keel's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * Both shell entry points already catch, report through `reportAttachmentFailure`
 * and return `false` rather than rejecting, so these wrappers need no `try` and a
 * click handler can call them directly. Neither re-exposes `Beat3dTimings`: a
 * skin has no reason to retune the framework's encode, and the budget-expiry
 * branches are covered once, in `src/shell/attach/stage-attachment.test.ts`.
 *
 * BOTH MOUNT POINTS ARE WIRED, in `skin.tsx`: `attachBulletinByHand` is the
 * chat-header paperclip, and `sendBulletinMessage` is what `onSuggestionSelect`
 * runs when it recognises `BULLETIN_MESSAGE`. The pill carrying that exact
 * message lives in `suggestions.ts` (a later slot's file) — until it does, the
 * paperclip is the whole beat-3d ingest path, and it works.
 *
 * ⚠️ `BULLETIN_MESSAGE` is the ONLY thing tying the pill to the interception. If
 * the pill's text drifts from this constant the click takes the DEFAULT send
 * path, which drops attachments: the prompt goes out without the file, the model
 * invents the bulletin's contents, and a durable brief gets filed that reads
 * perfectly and proves the opposite of the beat. Import the constant; never
 * retype the sentence.
 */

// Two lines, not one with an inline `type` — the commit hook's `oxlint --fix`
// (consistent-type-imports) rewrites the inline form.
import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";

/**
 * The only per-skin values this beat needs.
 *
 * THE SPACE IS NAMED rather than left to the route's `DEFAULT_SPACE`, for the
 * reason logistics names its carrier: the filename the composer chip prints and
 * the document the route builds can then never disagree. A corpus rename that
 * retires `privacy` now 404s this fetch and ABORTS the pill — the presenter is
 * told and nothing is sent — instead of quietly attaching some other space's
 * bulletin under a filename that says privacy.
 *
 * Privacy is the space the rest of the demo works: POL-114 is beat 6's teach
 * case and POL-121 is beat 5's stored procedure, so the documents this bulletin
 * lists are documents the room has already been looking at. It is also the space
 * whose fresh citation (POL-118, see `data/bulletin-citations.ts`) is the row
 * that proves the file was read.
 *
 * The filename matches the route's own `content-disposition`, so the chip, the
 * download and the server agree on one name.
 */
const BULLETIN: AttachmentDocument = {
  url: "/api/keel/v1/bulletin?space=privacy",
  filename: "bulletin-privacy.pdf",
};

/**
 * Shared between the pill in `suggestions.ts` and `skin.tsx`'s
 * `onSuggestionSelect` so the match cannot drift. A drifted string means the
 * pill takes the DEFAULT send path, which drops attachments — the prompt goes
 * out without the file and the model invents the bulletin's contents, filing a
 * durable brief that reads perfectly and proves the opposite of the beat.
 *
 * It names the artifact ("file the impact brief") rather than only the reading,
 * because beat 3d's claim is that what comes out belongs to the APPLICATION. A
 * message that asks only for a summary gets one, in the transcript, and the
 * durable half of the beat never happens.
 */
export const BULLETIN_MESSAGE =
  "Read this regulatory bulletin and file the impact brief.";

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachBulletinByHand = (): Promise<boolean> =>
  attachByHand(BULLETIN);

/** The pill path — stage, then drive the real composer. */
export const sendBulletinMessage = (): Promise<boolean> =>
  sendMessageWithAttachment(BULLETIN, BULLETIN_MESSAGE);
