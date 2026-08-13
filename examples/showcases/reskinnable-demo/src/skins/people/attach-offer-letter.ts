/**
 * BEAT 3d — stage the offer letter into the chat composer's built-in hidden
 * file input, so CopilotKit's standard attachment flow picks it up: the letter
 * appears as a real attachment chip and rides the next message to the model.
 *
 * Shared by the chat header's paperclip AND the suggestion pill, so both take
 * the identical blessed path (the one that correctly consumes attachments on
 * submit). The pill needs it because the framework's suggestion path DROPS
 * attachments — a pill that must carry a file has to be intercepted in
 * `onSuggestionSelect` and driven through the real composer instead.
 *
 * The paperclip exists as a manual fallback: if the pill path misbehaves on
 * stage, the presenter can still attach the file by hand and carry on.
 */

export const OFFER_LETTER_URL = "/api/people/v1/offer-letter";
export const OFFER_LETTER_FILENAME = "offer-letter-dana-whitfield.pdf";

export async function stageOfferLetterAttachment(): Promise<boolean> {
  try {
    const res = await fetch(OFFER_LETTER_URL);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], OFFER_LETTER_FILENAME, {
      type: "application/pdf",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="pdf"]',
    );
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // A native, BUBBLING change event, so CopilotChat's own onChange handler
    // runs and enqueues the attachment exactly as a manual pick would. A
    // React-synthetic dispatch would not reach it.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (err) {
    console.error("Could not attach the offer letter", err);
    return false;
  }
}
