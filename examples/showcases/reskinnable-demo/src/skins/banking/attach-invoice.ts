/**
 * BEAT 3d for banking — the bundled Q2 vendor invoice.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are banking's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * This file used to hold a `stageInvoiceAttachment` that dispatched a `change`
 * event and returned `true`, with the send half sitting in `skin.tsx` behind a
 * fixed 500 ms sleep that was NOT gated on staging — so a failed stage still
 * sent the prompt, the model invented the invoice's line items, and
 * `createReport` filed a report that read perfectly plausibly. Do not
 * reintroduce any of it; `sendMessageWithAttachment` aborts instead.
 */

import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";
// The pill's message stays in `suggestions.ts` next to the pill that carries it,
// so the catalog entry and this send are literally the same value and cannot
// drift into a prompt that goes out without the file.
import { Q2_REPORT_MESSAGE } from "@/skins/banking/suggestions";

/** The only per-skin values. */
const Q2_INVOICE: AttachmentDocument = {
  url: "/sample-invoice-q2.pdf",
  filename: "Meridian-Creative-Q2-invoice.pdf",
};

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachInvoiceByHand = (): Promise<boolean> =>
  attachByHand(Q2_INVOICE);

/** The pill path — stage, then drive the real composer. */
export const sendQ2WithInvoice = (): Promise<boolean> =>
  sendMessageWithAttachment(Q2_INVOICE, Q2_REPORT_MESSAGE);
