import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Behavioral e2e for the Multimodal Attachments demo (OpenClaw), run against
 * aimock (deterministic LLM). The gateway injects X-AIMock-Context: openclaw,
 * so these prompts match the fixtures in
 * showcase/aimock/d4/openclaw/chat.json.
 *
 * Mirrors the hermes multimodal spec but adapted to the OpenClaw topology:
 *
 * - This demo has its OWN runtime route (/api/copilotkit-multimodal) and its
 *   OWN agent slug (`multimodal-demo`) — see
 *   src/app/demos/multimodal/page.tsx and
 *   src/app/api/copilotkit-multimodal/route.ts.
 * - aimock is TEXT-ONLY: it cannot actually see the attached image/PDF bytes.
 *   OpenClaw's real gateway forwards image blocks to a vision model, but the
 *   deterministic mock matches on the auto-prompt SUBSTRING only and returns a
 *   canned description. The fixture-specific reply text ("logo" for the image,
 *   "document" for the PDF) is therefore the load-bearing proof that our
 *   fixture drove the run — NOT a real vision result.
 * - The sample buttons (sample-attachment-buttons.tsx) go through the V2 agent
 *   surface directly (`agent.addMessage` with text + attachment content parts,
 *   then `copilotkit.runAgent`). No file picker, no upload race. The
 *   auto-prompt lands as the user-message body and is what aimock keys on.
 * - The LegacyConverterShim (legacy-converter-shim.tsx) appends a legacy
 *   `binary` mirror on the way out and dedupes/normalizes media types on the
 *   way back. The rendering invariants below (exactly ONE image, PDF as a
 *   document chip and never a broken <img>) pin that shim's behavior — each
 *   was a real regression during the multimodal rewrite.
 *
 * Because these fixtures return plain `content` (no toolCalls), there is no
 * tool-call loop and the shared "returned:" TERMINATOR fixture is irrelevant
 * here — the run completes on the first assistant turn.
 */

const ROUTE = "/demos/multimodal";

const SAMPLE_IMAGE_BTN = '[data-testid="multimodal-sample-image-button"]';
const SAMPLE_PDF_BTN = '[data-testid="multimodal-sample-pdf-button"]';
const ADD_MENU_BUTTON = '[data-testid="copilot-add-menu-button"]';
const USER_MESSAGE = '[data-testid="copilot-user-message"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

// The canned auto-prompts live in sample-attachment-buttons.tsx — kept in sync
// here so the user-message bubble assertion (and the aimock match) stay
// accurate.
const IMAGE_PROMPT =
  "can you tell me what is in this demo image I just attached";
const PDF_PROMPT = "can you tell me what is in this demo pdf I just attached";

async function openDemo(page: Page) {
  await page.goto(ROUTE);
  await expect(
    page.locator('[data-testid="multimodal-demo-root"]'),
  ).toBeVisible({ timeout: 20000 });
}

/**
 * Wait until the sample-injection flow finishes for the nth user message: the
 * user bubble shows up, then the matching assistant response. Returns both
 * locators so the caller can probe for chips and dedupe invariants.
 */
async function waitForRoundTrip(
  page: Page,
  index = 0,
): Promise<{
  userMsg: ReturnType<Page["locator"]>;
  asstMsg: ReturnType<Page["locator"]>;
}> {
  const userMsg = page.locator(USER_MESSAGE).nth(index);
  await expect(userMsg).toBeVisible({ timeout: 60000 });
  const asstMsg = page.locator(ASSISTANT_MESSAGE).nth(index);
  await expect(asstMsg).toBeVisible({ timeout: 90000 });
  return { userMsg, asstMsg };
}

test.describe("Multimodal Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("page loads with the sample row, both sample buttons, and the paperclip", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="multimodal-sample-row"]'),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator(SAMPLE_IMAGE_BTN)).toBeEnabled();
    await expect(page.locator(SAMPLE_PDF_BTN)).toBeEnabled();
    await expect(page.locator(ADD_MENU_BUTTON)).toBeVisible({ timeout: 15000 });
  });

  test("sample image: auto-sends, user msg shows EXACTLY ONE image, assistant references it", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    // Auto-prompt landed as the user-message body — confirms the
    // addMessage / runAgent path fired and the prompt wasn't eaten.
    await expect(userMsg).toContainText(IMAGE_PROMPT);

    // Exactly ONE rendered image — pins the dedupe + normalize behavior of
    // the LegacyConverterShim so the round-trip can't quietly start doubling
    // attachments again.
    await expect(userMsg.locator("img")).toHaveCount(1);
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);

    // Fixture-specific reply text — proves this aimock fixture drove the run.
    await expect(asstMsg).toContainText(/logo|image/i);
  });

  test("sample PDF: auto-sends, user msg shows EXACTLY ONE document chip (not a broken image)", async ({
    page,
  }) => {
    await page.locator(SAMPLE_PDF_BTN).click();
    const { userMsg, asstMsg } = await waitForRoundTrip(page);

    await expect(userMsg).toContainText(PDF_PROMPT);

    // Pinned regression: PDFs round-tripped through the legacy converter used
    // to come back as `type: "image"` with `mimeType: application/pdf`,
    // forcing the image renderer to fail load and show "Failed to load image".
    // The shim's type-normalize turns them back into `document` parts so the
    // icon-+-filename DocumentAttachment renderer fires instead.
    await expect(userMsg.getByText(/Failed to load image/i)).toHaveCount(0);
    await expect(userMsg.locator("img")).toHaveCount(0);
    // DocumentAttachment surfaces a bold "PDF" label via getDocumentIcon.
    await expect(userMsg.getByText(/^PDF$/)).toBeVisible();

    // The PDF flatten text must never bleed into the rendered user bubble.
    await expect(userMsg).not.toContainText("[Attached document]");

    // Fixture-specific reply text — proves this aimock fixture drove the run.
    await expect(asstMsg).toContainText(/document|pdf/i);
  });

  test("image then PDF in the same session: each message keeps its own chip, no doubling", async ({
    page,
  }) => {
    await page.locator(SAMPLE_IMAGE_BTN).click();
    const first = await waitForRoundTrip(page, 0);
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    await page.locator(SAMPLE_PDF_BTN).click();
    const second = await waitForRoundTrip(page, 1);

    // First message still shows exactly one image — the second send must not
    // re-render or double the prior attachment.
    await expect(first.userMsg.locator("img")).toHaveCount(1);

    // Second message is a clean PDF chip.
    await expect(second.userMsg.locator("img")).toHaveCount(0);
    await expect(second.userMsg.getByText(/Failed to load image/i)).toHaveCount(
      0,
    );
    await expect(second.userMsg.getByText(/^PDF$/)).toBeVisible();
  });

  test("PDF then image in the same session: each message keeps its own chip, no doubling", async ({
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
