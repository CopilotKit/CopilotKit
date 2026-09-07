/**
 * BEAT 3d for people — Dana Whitfield's signed offer letter.
 *
 * Everything that makes this beat honest lives in `@/shell/attach`: locating the
 * composer before staging, checking the fetched bytes really are a PDF, waiting
 * on CONDITIONS (chip queued, chip printing its filename, send button in SEND
 * state, attachment consumed) with bounded budgets, aborting the send on any
 * failure, and reporting every failure through `console.error` AND
 * `window.alert`. Only three values are people's: the document's URL, its
 * filename, and the message the pill sends.
 *
 * This file used to hold a `stageOfferLetterAttachment` that dispatched a
 * `change` event and returned `true`, with the send half sitting in `skin.tsx`
 * behind a fixed 500 ms sleep that was NOT gated on staging — so a failed stage
 * still sent the prompt, the model invented the letter's terms, and the
 * onboarding packet was filed anyway and read perfectly plausibly. Do not
 * reintroduce any of it; `sendMessageWithAttachment` aborts instead.
 */

import { attachByHand, sendMessageWithAttachment } from "@/shell/attach";
import type { AttachmentDocument } from "@/shell/attach";
// The pill's message stays in `suggestions.ts` next to the pill that carries it,
// so the catalog entry and this send are literally the same value and cannot
// drift into a prompt that goes out without the file.
import { PACKET_MESSAGE } from "./suggestions";

/** The only per-skin values. */
const OFFER_LETTER: AttachmentDocument = {
  url: "/api/people/v1/offer-letter",
  filename: "offer-letter-dana-whitfield.pdf",
};

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachOfferLetterByHand = (): Promise<boolean> =>
  attachByHand(OFFER_LETTER);

/** The pill path — stage, then drive the real composer. */
export const sendPacketRequestWithOfferLetter = (): Promise<boolean> =>
  sendMessageWithAttachment(OFFER_LETTER, PACKET_MESSAGE);
