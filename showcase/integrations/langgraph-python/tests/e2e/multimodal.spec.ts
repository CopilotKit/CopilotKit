import { test, expect, Page } from "@playwright/test";

/**
 * E2E spec for the Multimodal Attachments demo (Wave 2b).
 *
 * Exercises the sample-file injection path only — the real OS file picker
 * isn't automatable through Playwright without a flakey host-file dependency,
 * whereas the sample path drives the same hidden file input under the hood
 * (DataTransfer + dispatch `change`) and therefore covers the same internal
 * code the paperclip path exercises.
 *
 * Assumes the demo is deployed at BASE_URL/demos/multimodal and that both
 * `public/demo-files/sample.png` and `public/demo-files/sample.pdf` are
 * bundled — the sample buttons fetch them at runtime.
 *
 * NOTE: against a live deploy the assistant response depends on a
 * vision-capable model (gpt-4o). When running against aimock, feature-parity
 * fixtures for "Describe this image" and "Summarize this document" ensure
 * deterministic responses that mention "CopilotKit" / "logo" so the soft
 * keyword assertions hold.
 */

const ROUTE = "/demos/multimodal";

// Selectors derived from sample-attachment-buttons.tsx and CopilotChat's
// internal test ids. The chip selector is best-effort — CopilotChat's
// AttachmentQueue chip doesn't currently expose a stable data-testid, so we
// fall back to the attachment preview thumbnail that only appears after a
// successful onUpload. If the chip selector drifts, tighten here.
const SAMPLE_IMAGE_BTN = '[data-testid="multimodal-sample-image-button"]';
const SAMPLE_PDF_BTN = '[data-testid="multimodal-sample-pdf-button"]';
const CHAT_TEXTAREA = '[data-testid="copilot-chat-textarea"]';
const SEND_BUTTON = '[data-testid="copilot-send-button"]';
const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]';
// Attachment chip selector — CopilotChat's AttachmentQueue renders chips
// inside the input toolbar. Until a stable data-testid is added, match on
// the filename that the sample path always populates.
const IMAGE_CHIP_LOCATOR = "text=sample.png";
const PDF_CHIP_LOCATOR = "text=sample.pdf";

async function openDemo(page: Page) {
  await page.goto(ROUTE);
  await expect(
    page.getByRole("heading", { name: "Multimodal attachments" }),
  ).toBeVisible();
}

test.describe("Multimodal Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("page loads with sample row, sample buttons, composer, and paperclip", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="multimodal-sample-row"]'),
    ).toBeVisible();
    await expect(page.locator(SAMPLE_IMAGE_BTN)).toBeEnabled();
    await expect(page.locator(SAMPLE_PDF_BTN)).toBeEnabled();
    await expect(page.locator(CHAT_TEXTAREA)).toBeVisible();
    // Paperclip / Add attachments menu button — CopilotChatInput's data-testid.
    await expect(page.locator(ADD_MENU_BUTTON)).toBeVisible();
  });

  test("sample image injection queues an attachment chip", async ({ page }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    // Attachment chip appears within 10s — FileReader + base64 on a <50KB PNG
    // should finish in <1s on a reasonable machine, but allow generously for
    // CI variance.
    await expect(page.locator(IMAGE_CHIP_LOCATOR).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("sample PDF injection queues an attachment chip", async ({ page }) => {
    await page.locator(SAMPLE_PDF_BTN).click();
    await expect(page.locator(PDF_CHIP_LOCATOR).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("sending with an image attachment produces an agent response that references the image", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    await expect(page.locator(IMAGE_CHIP_LOCATOR).first()).toBeVisible({
      timeout: 10000,
    });

    await page.locator(CHAT_TEXTAREA).fill("Describe this image");
    await page.locator(SEND_BUTTON).click();

    // Assistant message renders — use role-based locator as a stable anchor.
    const assistantMessage = page.locator('[data-role="assistant"]').first();
    await expect(assistantMessage).toBeVisible({ timeout: 90000 });
    // Soft assertion: mentions CopilotKit, logo, or image-ish keywords.
    // Loosened to avoid flakes when the vision model paraphrases; the
    // aimock fixture response hits both keywords so deterministic CI is fine.
    await expect(assistantMessage).toContainText(/copilotkit|logo|image/i, {
      timeout: 5000,
    });
  });

  test("sending with a PDF attachment produces an agent response mentioning CopilotKit", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BTN).click();
    await expect(page.locator(PDF_CHIP_LOCATOR).first()).toBeVisible({
      timeout: 10000,
    });

    await page.locator(CHAT_TEXTAREA).fill("Summarize this document");
    await page.locator(SEND_BUTTON).click();

    const assistantMessage = page.locator('[data-role="assistant"]').first();
    await expect(assistantMessage).toBeVisible({ timeout: 90000 });
    // The sample PDF contains the word "CopilotKit" multiple times and the
    // aimock fixture mirrors that in its response.
    await expect(assistantMessage).toContainText(/copilotkit/i, {
      timeout: 5000,
    });
  });
});
