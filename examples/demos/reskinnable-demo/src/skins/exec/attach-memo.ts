/**
 * BEAT 3d for exec — the generated Distribution budget memo.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are exec's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * This file used to hold a `stageInvoiceAttachment` that dispatched a `change`
 * event and returned `true`, with the send half sitting in `skin.tsx` behind a
 * fixed 500 ms sleep that was NOT gated on staging — so a failed stage still
 * sent the prompt, the model invented the invoice's line items, and
 * `createReport` filed a report that read perfectly plausibly. Do not
 * reintroduce any of it; `sendMessageWithAttachment` aborts instead.
 *
 * Unlike banking's Q2 invoice (a static file under `public/`), this memo is
 * GENERATED PER REQUEST from the live store — see
 * `src/app/api/exec/v1/budget-memo/route.ts` — so its figures always agree
 * with the dashboard the presenter is showing at that exact instant. That
 * also means it can fail in a way a static file cannot: a reseed that removes
 * the Distribution opex breach 404s this fetch and ABORTS the pill — the
 * presenter is told and nothing is sent — rather than attaching a stale
 * document.
 */

import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";
// The pill's message stays in `suggestions.ts` next to the pill that carries it,
// so the catalog entry and this send are literally the same value and cannot
// drift into a prompt that goes out without the file.
import { MEMO_NARRATIVE_MESSAGE } from "@/skins/exec/suggestions";

/**
 * The only per-skin values.
 *
 * The filename matches the route's own `content-disposition`, so the chip,
 * the download and the server agree on one name.
 */
const BUDGET_MEMO: AttachmentDocument = {
  url: "/api/exec/v1/budget-memo",
  filename: "Cascade-Distribution-budget-memo.pdf",
};

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachMemoByHand = (): Promise<boolean> =>
  attachByHand(BUDGET_MEMO);

/** The pill path — stage, then drive the real composer. */
export const sendMemoWithAttachment = (): Promise<boolean> =>
  sendMessageWithAttachment(BUDGET_MEMO, MEMO_NARRATIVE_MESSAGE);
