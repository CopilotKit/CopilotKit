import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * E2E spec for the Multimodal Attachments demo.
 *
 * Exercises the sample-file injection path only — the real OS file picker
 * isn't automatable through Playwright without a flakey host-file dependency,
 * whereas the sample buttons drive the same agent surface that the paperclip
 * path eventually feeds and therefore cover the rendering / round-trip path
 * end to end.
 *
 * Behavior pinned by this suite (each was an actual regression caught
 * during the multimodal rewrite, see the page.tsx and
 * sample-attachment-buttons.tsx headers for context):
 *
 * 1. Clicking a sample button auto-sends the canned prompt — no manual
 *    fill / send required.
 * 2. The user message keeps showing exactly ONE attachment chip after
 *    the assistant response arrives. Earlier the @ag-ui/langgraph
 *    round-trip duplicated the attachment (modern + re-converted shape)
 *    so the user saw two thumbnails for one file.
 * 3. Sample-PDF specifically renders as a `DocumentAttachment` chip,
 *    NOT as an `<img>` that errors with "Failed to load image".
 *    Earlier the round-trip mis-tagged PDFs with `type: "image"` and
 *    forced the image renderer.
 * 4. Clicking image then PDF in the same session (and vice versa)
 *    leaves each user message with its own single, correct chip — no
 *    cross-contamination, no doubling, no flattened-PDF text bleed.
 *
 * Assumes the demo is reachable at BASE_URL/demos/multimodal and aimock
 * is configured to match the bundled sample fingerprints (the PDF body
 * "CopilotKit Quickstart\nAdd AI copilots..." substring; the literal
 * "this image" substring in the sample-image autoPrompt).
 */

const ROUTE = "/demos/multimodal";

const SAMPLE_IMAGE_BTN = '[data-testid="multimodal-sample-image-button"]';
const SAMPLE_PDF_BTN = '[data-testid="multimodal-sample-pdf-button"]';
const CHAT_TEXTAREA = '[data-testid="copilot-chat-textarea"]';
const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]';
const USER_MESSAGE = '[data-testid="copilot-user-message"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

async function openDemo(page: Page) {
  await page.goto(ROUTE);
  await expect(
    page.getByRole("heading", { name: "Multimodal attachments" }),
  ).toBeVisible();
}

/**
 * Wait until the sample-injection flow finishes: a user message shows up,
 * an assistant message responds. Returns the user message locator so the
 * caller can probe it for attachment chips and dedup invariants.
 */
async function waitForRoundTrip(page: Page, userIndex = 0) {
  const userMsg = page.locator(USER_MESSAGE).nth(userIndex);
  await expect(userMsg).toBeVisible({ timeout: 60000 });
  const asstMsg = page.locator(ASSISTANT_MESSAGE).nth(userIndex);
  await expect(asstMsg).toBeVisible({ timeout: 90000 });
  return { userMsg, asstMsg };
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
    await expect(page.locator(ADD_MENU_BUTTON)).toBeVisible();
  });

  test("sample image: auto-sends, user msg shows EXACTLY ONE image, assistant references it", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    // Auto-prompt landed.
    await expect(userMsg).toContainText("Describe this image");

    // Exactly ONE rendered image — pin the dedupe + normalize behavior so
    // the @ag-ui/langgraph round-trip can't quietly start doubling
    // attachments again.
    await expect(userMsg.locator("img")).toHaveCount(1);
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);

    await expect(asstMsg).toContainText(/copilotkit|logo|image/i);
  });

  test("sample PDF: auto-sends, user msg shows EXACTLY ONE document chip (not a broken image)", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BTN).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    await expect(userMsg).toContainText("Summarize this PDF");

    // Pinned regression: PDFs round-tripped through @ag-ui/langgraph used
    // to come back as `type: "image"` with `mimeType: application/pdf`,
    // forcing the image renderer to fail load and show "Failed to load
    // image" twice. The page-level dedupe + type-normalize subscriber
    // turns them back into `document` parts so the icon-+-filename
    // renderer fires exactly once.
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);
    await expect(userMsg.locator("img")).toHaveCount(0);
    // The DocumentAttachment chip surfaces a "PDF" label via getDocumentIcon.
    await expect(userMsg.getByText(/^PDF$/)).toBeVisible();

    // Pinned regression: the PDF flattened text used to bleed into the
    // user message body when the Python middleware mutated state via
    // `before_model`. Ensure that text never lands in the rendered
    // message.
    await expect(userMsg).not.toContainText("[Attached document]");

    await expect(asstMsg).toContainText(/copilotkit/i);
  });

  test("image then PDF in same session: each message keeps its own chip, no doubling", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    const first = await waitForRoundTrip(page, 0);
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    await page.locator(SAMPLE_PDF_BTN).click();
    const second = await waitForRoundTrip(page, 1);

    // First message still shows exactly one image — the second send must
    // not re-render or double the prior attachment.
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    // Second message is a clean PDF chip.
    await expect(second.userMsg.locator("img")).toHaveCount(0);
    await expect(second.userMsg.getByText(/Failed to load image/i)).toHaveCount(
      0,
    );
    await expect(second.userMsg.getByText(/^PDF$/)).toBeVisible();
  });

  test("PDF then image in same session: each message keeps its own chip, no doubling", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BTN).click();
    const first = await waitForRoundTrip(page, 0);
    await expect(first.userMsg.locator("img")).toHaveCount(0);
    await expect(first.userMsg.getByText(/^PDF$/)).toBeVisible();

    await page.locator(SAMPLE_IMAGE_BTN).click();
    const second = await waitForRoundTrip(page, 1);

    // First message still shows the PDF chip — no contamination.
    await expect(first.userMsg.getByText(/^PDF$/)).toBeVisible();
    await expect(first.userMsg.locator("img")).toHaveCount(0);

    // Second message has exactly one image, no broken-image fallback.
    await expect(second.userMsg.locator("img")).toHaveCount(1);
    await expect(second.userMsg.getByText(/Failed to load image/i)).toHaveCount(
      0,
    );
  });
});
