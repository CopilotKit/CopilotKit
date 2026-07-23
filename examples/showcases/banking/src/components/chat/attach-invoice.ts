/**
 * Stage the bundled Q2 vendor invoice into the chat composer's (built-in)
 * hidden file input, so CopilotKit's standard attachment flow picks it up: the
 * invoice shows as a real attachment chip in the composer and rides the next
 * message to the model. Shared by the header's paperclip button and the Q2
 * demo suggestion pill so both use the exact same, blessed attachment path
 * (which correctly consumes attachments on submit).
 *
 * Returns true if the file was staged.
 */
export const INVOICE_URL = "/sample-invoice-q2.pdf";
export const INVOICE_FILENAME = "Meridian-Creative-Q2-invoice.pdf";

export async function stageInvoiceAttachment(): Promise<boolean> {
  try {
    const res = await fetch(INVOICE_URL);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], INVOICE_FILENAME, {
      type: "application/pdf",
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="pdf"]',
    );
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // Native, bubbling change event so CopilotChat's onChange handler runs and
    // enqueues the attachment exactly as a manual pick would.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (err) {
    console.error("Could not attach the sample invoice", err);
    return false;
  }
}
