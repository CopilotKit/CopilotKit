import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

/**
 * The multimodal attachments demo, through the sample buttons only: a real
 * OS file picker cannot be automated without a file on the test host. The
 * sample buttons send through the same agent as the paperclip path, so these
 * tests cover the render and the round trip end to end.
 *
 * Each pinned behavior was a real regression:
 *
 * 1. A sample button sends its prompt on its own. No fill or send needed.
 * 2. The user message keeps exactly ONE attachment chip after the reply. A
 *    round trip used to duplicate the attachment, so one file showed twice.
 * 3. The sample PDF renders as a document chip, NOT as an `<img>` that fails
 *    with "Failed to load image". A round trip used to tag PDFs as images.
 * 4. The flattened PDF text never shows in the user message.
 * 5. An image and then a PDF in one session (and the other way round) leave
 *    each user message with its own single, correct chip.
 *
 * The integration's aimock fixtures answer the two sample prompts.
 */

const SAMPLE_IMAGE_BUTTON = '[data-testid="multimodal-sample-image-button"]';
const SAMPLE_PDF_BUTTON = '[data-testid="multimodal-sample-pdf-button"]';
const CHAT_TEXTAREA = '[data-testid="copilot-chat-textarea"]';
const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]';
const USER_MESSAGE = '[data-testid="copilot-user-message"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

// The prompts that the sample buttons send.
const IMAGE_PROMPT =
  "can you tell me what is in this demo image I just attached";
const PDF_PROMPT = "can you tell me what is in this demo pdf I just attached";

/**
 * Waits until the nth sample send finishes: its user message shows, then the
 * matching assistant reply. Returns both, to check their chips.
 */
async function waitForRoundTrip(page: Page, index = 0) {
  const userMsg = page.locator(USER_MESSAGE).nth(index);
  await expect(userMsg).toBeVisible({ timeout: 60_000 });
  const asstMsg = page.locator(ASSISTANT_MESSAGE).nth(index);
  await expect(asstMsg).toBeVisible({ timeout: 90_000 });
  return { userMsg, asstMsg };
}

describeDemo("multimodal", "Multimodal Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("multimodal"));
    await expect(
      page.locator('[data-testid="multimodal-demo-root"]'),
    ).toBeVisible();
  });

  test("page loads with sample row, sample buttons, composer, and paperclip", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="multimodal-sample-row"]'),
    ).toBeVisible();
    await expect(page.locator(SAMPLE_IMAGE_BUTTON)).toBeEnabled();
    await expect(page.locator(SAMPLE_PDF_BUTTON)).toBeEnabled();
    await expect(page.locator(CHAT_TEXTAREA)).toBeVisible();
    await expect(page.locator(ADD_MENU_BUTTON)).toBeVisible();
  });

  test("sample image: auto-sends, user msg shows EXACTLY ONE image, assistant references it", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BUTTON).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    // The prompt became the user message, so the send went through.
    await expect(userMsg).toContainText(IMAGE_PROMPT);

    // Exactly ONE image renders: no duplicate after the round trip.
    await expect(userMsg.locator("img")).toHaveCount(1);
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);

    await expect(asstMsg).toContainText(/copilotkit|logo|image/i);
  });

  test("sample PDF: auto-sends, user msg shows EXACTLY ONE document chip (not a broken image)", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BUTTON).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    await expect(userMsg).toContainText(PDF_PROMPT);

    // A PDF that comes back tagged as an image renders a failing <img>.
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);
    await expect(userMsg.locator("img")).toHaveCount(0);
    // The document chip shows a "PDF" label.
    await expect(userMsg.getByText(/^PDF$/)).toBeVisible();

    // The flattened PDF text must never show in the user message.
    await expect(userMsg).not.toContainText("[Attached document]");

    await expect(asstMsg).toContainText(/copilotkit/i);
  });

  test("image then PDF in same session: each message keeps its own chip, no doubling", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BUTTON).click();
    const first = await waitForRoundTrip(page, 0);
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    await page.locator(SAMPLE_PDF_BUTTON).click();
    const second = await waitForRoundTrip(page, 1);

    // The second send must not double the first message's image.
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    await expect(second.userMsg.locator("img")).toHaveCount(0);
    await expect(second.userMsg.getByText(/Failed to load image/i)).toHaveCount(
      0,
    );
    await expect(second.userMsg.getByText(/^PDF$/)).toBeVisible();
  });

  test("PDF then image in same session: each message keeps its own chip, no doubling", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BUTTON).click();
    const first = await waitForRoundTrip(page, 0);
    await expect(first.userMsg.locator("img")).toHaveCount(0);
    await expect(first.userMsg.getByText(/^PDF$/)).toBeVisible();

    await page.locator(SAMPLE_IMAGE_BUTTON).click();
    const second = await waitForRoundTrip(page, 1);

    // The first message still shows its PDF chip.
    await expect(first.userMsg.getByText(/^PDF$/)).toBeVisible();
    await expect(first.userMsg.locator("img")).toHaveCount(0);

    await expect(second.userMsg.locator("img")).toHaveCount(1);
    await expect(second.userMsg.getByText(/Failed to load image/i)).toHaveCount(
      0,
    );
  });
});
