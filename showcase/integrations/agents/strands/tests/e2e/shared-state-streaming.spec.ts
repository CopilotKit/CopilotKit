import { test, expect } from "@playwright/test";

test.describe("State Streaming", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-streaming");
  });

  test("page loads with document editor and sidebar", async ({ page }) => {
    // The document editor has a textarea
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // The sidebar should show "AI Document Editor" title
    await expect(page.getByText("AI Document Editor")).toBeVisible({
      timeout: 10000,
    });
  });

  test("sidebar has chat input", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("document editor placeholder is visible when empty", async ({
    page,
  }) => {
    await expect(page.getByText("Write whatever you want here...")).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("user can type in the document editor", async ({ page }) => {
    // The main textarea should accept text
    const editorTextarea = page.locator("textarea.w-full").first();
    await editorTextarea.fill("This is my test document content.");

    await expect(editorTextarea).toHaveValue(
      "This is my test document content.",
    );
  });

  test("asking agent to edit shows confirm changes modal", async ({ page }) => {
    // Add some content to the editor
    const editorTextarea = page.locator("textarea.w-full").first();
    await editorTextarea.fill("Draft proposal for Q2 project.");

    // Ask the agent to modify via the sidebar chat
    const chatInputs = page.locator(
      'textarea[placeholder], [placeholder*="message"]',
    );
    const chatInput = chatInputs.last();
    await chatInput.fill("Expand this into a full project proposal");
    await chatInput.press("Enter");

    // The ConfirmChanges modal should appear with accept/reject buttons
    const confirmModal = page.locator('[data-testid="confirm-changes-modal"]');
    await expect(confirmModal).toBeVisible({ timeout: 60000 });

    // Should show the "Confirm Changes" heading
    await expect(confirmModal.getByText("Confirm Changes")).toBeVisible();

    // Should have Reject and Confirm buttons
    await expect(page.locator('[data-testid="reject-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-button"]')).toBeVisible();
  });

  test("accepting changes updates status display", async ({ page }) => {
    const editorTextarea = page.locator("textarea.w-full").first();
    await editorTextarea.fill("Meeting notes from today.");

    const chatInputs = page.locator(
      'textarea[placeholder], [placeholder*="message"]',
    );
    const chatInput = chatInputs.last();
    await chatInput.fill("Rewrite these notes in a more formal tone");
    await chatInput.press("Enter");

    // Wait for confirm modal
    const confirmButton = page.locator('[data-testid="confirm-button"]');
    await expect(confirmButton).toBeVisible({ timeout: 60000 });

    // Click confirm
    await confirmButton.click();

    // The status should show "Accepted"
    await expect(page.locator('[data-testid="status-display"]')).toHaveText(
      "Accepted",
    );
  });

  test("rejecting changes updates status display", async ({ page }) => {
    const editorTextarea = page.locator("textarea.w-full").first();
    await editorTextarea.fill("Budget report for Q3.");

    const chatInputs = page.locator(
      'textarea[placeholder], [placeholder*="message"]',
    );
    const chatInput = chatInputs.last();
    await chatInput.fill("Make this more detailed with bullet points");
    await chatInput.press("Enter");

    // Wait for confirm modal
    const rejectButton = page.locator('[data-testid="reject-button"]');
    await expect(rejectButton).toBeVisible({ timeout: 60000 });

    // Click reject
    await rejectButton.click();

    // The status should show "Rejected"
    await expect(page.locator('[data-testid="status-display"]')).toHaveText(
      "Rejected",
    );
  });

  test("confirm modal shows diff of proposed changes", async ({ page }) => {
    const editorTextarea = page.locator("textarea.w-full").first();
    await editorTextarea.fill("Simple draft text.");

    const chatInputs = page.locator(
      'textarea[placeholder], [placeholder*="message"]',
    );
    const chatInput = chatInputs.last();
    await chatInput.fill("Rewrite this as a formal letter");
    await chatInput.press("Enter");

    // Wait for confirm modal
    const confirmModal = page.locator('[data-testid="confirm-changes-modal"]');
    await expect(confirmModal).toBeVisible({ timeout: 60000 });

    // Modal should contain the proposed new content (not empty)
    const modalText = await confirmModal.textContent();
    expect(modalText).toBeTruthy();
    expect(modalText!.length).toBeGreaterThan(20);

    // Both action buttons should be present
    await expect(page.locator('[data-testid="reject-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="confirm-button"]')).toBeVisible();
  });
});
