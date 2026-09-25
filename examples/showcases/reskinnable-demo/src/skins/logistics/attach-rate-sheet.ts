/**
 * BEAT 3d for logistics — Pacific Star Line's forward carrier rate sheet.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are this skin's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * Both shell entry points already catch, report through `reportAttachmentFailure`
 * and return `false` rather than rejecting, so these wrappers need no `try` and a
 * click handler can call them directly.
 */

import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";

/**
 * The only per-skin values this beat needs.
 *
 * The carrier is NAMED rather than left to the route's default, so the filename
 * the composer chip prints and the document the route builds can never disagree:
 * a reseed that renames this carrier now 404s the fetch and ABORTS the pill (the
 * presenter is told, and nothing is sent), instead of quietly attaching some
 * other carrier's sheet under this filename.
 *
 * Pacific Star Line is the carrier on PO-88213, the shipment the rest of the
 * demo works, so the rates in this document land on lanes the room has already
 * been looking at.
 */
const RATE_SHEET: AttachmentDocument = {
  url: "/api/logistics/v1/rate-sheet?carrier=Pacific%20Star%20Line",
  filename: "pacific-star-line-rate-sheet.pdf",
};

/**
 * Shared between the pill in `suggestions.ts` and `skin.tsx`'s
 * `onSuggestionSelect` so the match cannot drift. A drifted string means the
 * pill takes the DEFAULT send path, which drops attachments — the prompt goes
 * out without the file and the model invents the document's contents.
 */
export const RATE_SHEET_MESSAGE =
  "Ingest this carrier rate sheet and file the rate brief.";

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachRateSheetByHand = (): Promise<boolean> =>
  attachByHand(RATE_SHEET);

/** The pill path — stage, then drive the real composer. */
export const sendRateSheetMessage = (): Promise<boolean> =>
  sendMessageWithAttachment(RATE_SHEET, RATE_SHEET_MESSAGE);
