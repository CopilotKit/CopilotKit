/**
 * BEAT 3d for commerce — Kestrel Mills' autumn vendor price sheet.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are commerce's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * This file WAS that chain — 612 lines of it, which banking and people then did
 * not have. It moved to the shell in `src/shell/attach/stage-attachment.ts`
 * verbatim (plus the three parameters), so all three skins now share one
 * implementation and one set of tests instead of one good copy and two partial
 * ones.
 */

import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";
// The pill's message stays in `suggestions.ts` next to the pill that carries it,
// so the catalog entry and this send are literally the same value and cannot
// drift into a prompt that goes out without the file.
import { RESTOCK_PLAN_MESSAGE } from "./suggestions";

/** The only per-skin values. */
const PRICE_SHEET: AttachmentDocument = {
  url: "/api/commerce/v1/price-sheet",
  filename: "price-sheet-kestrel-mills.pdf",
};

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachPriceSheetByHand = (): Promise<boolean> =>
  attachByHand(PRICE_SHEET);

/** The pill path — stage, then drive the real composer. */
export const sendRestockRequestWithPriceSheet = (): Promise<boolean> =>
  sendMessageWithAttachment(PRICE_SHEET, RESTOCK_PLAN_MESSAGE);
