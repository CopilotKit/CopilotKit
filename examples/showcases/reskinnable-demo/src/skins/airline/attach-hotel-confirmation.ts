/**
 * BEAT 3d for airline — Camila's Casa Miraflores hotel confirmation.
 *
 * ⚠️ SHIPPED UNMOUNTED. `skin.tsx`, `suggestions.ts` and `tools.tsx` belong to a
 * later slot; nothing imports this file yet. What that slot has to wire:
 *
 *   - `HOTEL_CONFIRMATION_MESSAGE` → the beat-3d pill's `message`
 *   - `sendHotelConfirmationMessage` → `skin.onSuggestionSelect`, on the pill
 *     whose message is that constant
 *   - `attachHotelConfirmationByHand` → a `skin.chatHeaderActions` paperclip
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
 * The BOOKING IS NAMED rather than left to the route's default, for the reason
 * logistics names its carrier: a reseed that renames or moves this trip now 404s
 * the fetch and ABORTS the pill (the presenter is told, and nothing is sent),
 * instead of quietly attaching some other traveler's reservation. `bkg-av1423`
 * is Camila's Lima trip — the one flight in the seed whose 55-minute delay lands
 * it AFTER the desk stops taking arrivals, which is the collision the brief is
 * built to state.
 *
 * The filename is the one `GET /hotel-confirmation` derives for its own
 * `content-disposition` (`hotel-confirmation-<confirmation number, lowercased>`).
 * They are written out in two places because the composer chip prints THIS one:
 * the chain never reads the response header, so a mismatch would put a filename
 * on stage that the document itself does not carry.
 * `attach-hotel-confirmation.test.ts` pins the pair against the real route.
 */
const HOTEL_CONFIRMATION: AttachmentDocument = {
  url: "/api/airline/v1/hotel-confirmation?booking=bkg-av1423",
  filename: "hotel-confirmation-cm-77q4132.pdf",
};

/**
 * Shared between the beat-3d pill in `suggestions.ts` and `skin.tsx`'s
 * `onSuggestionSelect` so the match cannot drift. A drifted string means the
 * pill takes the DEFAULT send path, which drops attachments — the prompt goes
 * out without the file and the model invents the document's contents, which is
 * the one failure this beat cannot survive.
 *
 * It lives HERE rather than in `suggestions.ts` (commerce's choice) because this
 * slot does not own `suggestions.ts`; logistics keeps it next to the send for the
 * same reason, and either way there is exactly one copy.
 */
export const HOTEL_CONFIRMATION_MESSAGE =
  "Read my hotel confirmation and file the trip brief.";

/**
 * The chat header's paperclip — stage only, no send. The presenter's manual
 * fallback if the pill path misbehaves on stage, so it is also the loudest link
 * in the chain: every failure has already been reported when this resolves
 * `false`.
 */
export const attachHotelConfirmationByHand = (): Promise<boolean> =>
  attachByHand(HOTEL_CONFIRMATION);

/** The pill path — stage, then drive the real composer. */
export const sendHotelConfirmationMessage = (): Promise<boolean> =>
  sendMessageWithAttachment(HOTEL_CONFIRMATION, HOTEL_CONFIRMATION_MESSAGE);
