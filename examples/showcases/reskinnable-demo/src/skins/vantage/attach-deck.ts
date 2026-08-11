/**
 * Stage the bundled Q2 board deck into the chat composer's built-in hidden file
 * input, so CopilotKit's standard attachment flow picks it up: the deck shows as
 * a real attachment chip and rides the next message to the model.
 *
 * Shared by the chat header's paperclip and the "rebuild the deck" suggestion
 * pill, so both take the same blessed attachment path (the framework's
 * suggestion path drops attachments, so a pill that carries a file must drive
 * the real composer manually instead). Ported in shape from banking's
 * attach-invoice.ts / sendQ2WithInvoice.
 */
// A PUBLIC ASSET, not an in-skin route: it must NOT go through `useVantageHref`.
// `src/proxy.ts`'s matcher excludes any path carrying a file extension, so a
// locked deploy serves this from the root exactly as the unlocked one does —
// prefixing it would break the multimodal beat under a lock.
export const DECK_URL = "/sample-exec-deck-q2.pdf";
export const DECK_FILENAME = "Q2-2026-executive-review.pdf";

/**
 * Shared between the suggestion pill and the interceptor in skin.tsx. A literal
 * duplicated in two files is the thing that silently breaks this beat when one
 * copy is edited.
 */
export const REBUILD_DECK_MESSAGE =
  "Rebuild last quarter's deck with current numbers and file it as a board.";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Set a React-controlled textarea's value so its onChange fires. */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function stageDeckAttachment(): Promise<boolean> {
  try {
    const res = await fetch(DECK_URL);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], DECK_FILENAME, { type: "application/pdf" });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="pdf"]',
    );
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // Native bubbling change event so CopilotChat's onChange handler enqueues
    // the attachment exactly as a manual pick would.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (err) {
    console.error("Could not attach the sample deck", err);
    return false;
  }
}

/** Stage the deck, type the rebuild request, click send — via the real composer. */
export async function sendRebuildWithDeck(): Promise<void> {
  const staged = await stageDeckAttachment();
  // Let the built-in attachment handler finish base64-encoding the file so the
  // composer's send is not blocked by an "uploading" attachment.
  if (staged) await wait(500);

  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="copilot-chat-textarea"]',
  );
  if (!textarea) return;
  setTextareaValue(textarea, REBUILD_DECK_MESSAGE);
  await wait(60);

  const sendButton = document.querySelector<HTMLButtonElement>(
    'button[data-testid="copilot-send-button"]',
  );
  sendButton?.click();
}
