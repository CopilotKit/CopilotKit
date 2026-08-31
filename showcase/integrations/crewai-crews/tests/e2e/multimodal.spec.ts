import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * E2E spec for the Multimodal Attachments demo.
 *
 * Exercises the sample-file injection path only — the real OS file
 * picker isn't automatable through Playwright without a flakey host-
 * file dependency. The sample buttons go through the same V2 agent
 * surface (`agent.addMessage` + `copilotkit.runAgent`) that the
 * paperclip path ultimately feeds, so this suite covers the render +
 * round-trip path end-to-end.
 *
 * Behavior pinned by this suite (each was an actual regression caught
 * during the multimodal rewrite — see headers in
 * sample-attachment-buttons.tsx and legacy-converter-shim.tsx):
 *
 * 1. Clicking a sample button auto-sends the canned prompt — no manual
 *    fill / send required. Earlier the DataTransfer-into-file-input
 *    approach raced the upload state, the send got rejected, and the
 *    prompt got eaten.
 * 2. The user message keeps showing exactly ONE attachment chip after
 *    the assistant response arrives. The @ag-ui/langgraph round-trip
 *    used to duplicate the attachment (modern + re-converted shape) so
 *    the user saw two thumbnails for one file.
 * 3. Sample-PDF specifically renders as a `DocumentAttachment` chip,
 *    NOT as an `<img>` that errors with "Failed to load image". Earlier
 *    the round-trip mis-tagged PDFs with `type: "image"` and forced the
 *    image renderer.
 * 4. The PDF flattened text doesn't bleed into the rendered user
 *    message. Earlier `_PdfFlattenMiddleware` ran in `before_model`
 *    and persisted the flattened "[Attached document]\n<pdf body>"
 *    into state, which the chat UI rendered inline.
 * 5. Clicking image then PDF in the same session (and vice versa)
 *    leaves each user message with its own single, correct chip — no
 *    cross-contamination, no doubling.
 *
 * Assumes the demo is reachable at BASE_URL/demos/multimodal and
 * aimock is configured with the canned prompts:
 *   - "can you tell me what is in this demo image I just attached"
 *   - "can you tell me what is in this demo pdf I just attached"
 * Both fixtures live in showcase/aimock/feature-parity.json.
 */

const ROUTE = "/demos/multimodal";

const SAMPLE_IMAGE_BTN = '[data-testid="multimodal-sample-image-button"]';
const SAMPLE_PDF_BTN = '[data-testid="multimodal-sample-pdf-button"]';
const CHAT_TEXTAREA = '[data-testid="copilot-chat-textarea"]';
const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]';
const USER_MESSAGE = '[data-testid="copilot-user-message"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

// The canned auto-prompts live in sample-attachment-buttons.tsx — kept in
// sync here so the user-message bubble assertion stays accurate.
const IMAGE_PROMPT =
  "can you tell me what is in this demo image I just attached";
const PDF_PROMPT = "can you tell me what is in this demo pdf I just attached";

async function openDemo(page: Page) {
  await page.goto(ROUTE);
  await expect(
    page.locator('[data-testid="multimodal-demo-root"]'),
  ).toBeVisible();
}

/**
 * Wait until the sample-injection flow finishes for the nth user message:
 * the user bubble shows up, then the matching assistant response. Returns
 * both locators so the caller can probe for chips and dedup invariants.
 */
async function waitForRoundTrip(
  page: Page,
  index = 0,
): Promise<{
  userMsg: ReturnType<Page["locator"]>;
  asstMsg: ReturnType<Page["locator"]>;
}> {
  const userMsg = page.locator(USER_MESSAGE).nth(index);
  await expect(userMsg).toBeVisible({ timeout: 60_000 });
  const asstMsg = page.locator(ASSISTANT_MESSAGE).nth(index);
  await expect(asstMsg).toBeVisible({ timeout: 90_000 });
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

    // Auto-prompt landed as the user message body — confirms the
    // useAgent / runAgent path fired and the prompt wasn't eaten.
    await expect(userMsg).toContainText(IMAGE_PROMPT);

    // Exactly ONE rendered image — pin the dedupe + normalize behavior
    // so the @ag-ui/langgraph round-trip can't quietly start doubling
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

    await expect(userMsg).toContainText(PDF_PROMPT);

    // Pinned regression: PDFs round-tripped through @ag-ui/langgraph
    // used to come back as `type: "image"` with `mimeType:
    // application/pdf`, forcing the image renderer to fail load and
    // show "Failed to load image" twice. The page-level dedupe + type-
    // normalize subscriber turns them back into `document` parts so
    // the icon-+-filename renderer fires exactly once.
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);
    await expect(userMsg.locator("img")).toHaveCount(0);
    // DocumentAttachment surfaces a "PDF" label via getDocumentIcon.
    await expect(userMsg.getByText(/^PDF$/)).toBeVisible();

    // Pinned regression: the PDF flattened text used to bleed into the
    // rendered user message when the Python middleware mutated state
    // via `before_model`. Switching to `wrap_model_call` scopes the
    // rewrite to the model request only — the bracket-tagged dump must
    // never appear in the UI bubble.
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

    // First message still shows exactly one image — the second send
    // must not re-render or double the prior attachment.
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
