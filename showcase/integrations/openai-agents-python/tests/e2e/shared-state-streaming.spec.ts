import { test, expect } from "@playwright/test";

// Shared State (Streaming) — Document Viewer demo. The agent streams a
// `document` field in its state; the frontend renders it token-by-token
// in a read-only DocumentView panel alongside a CopilotSidebar.
test.describe("State Streaming", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-streaming");
  });

  test("page loads with document panel and chat sidebar", async ({ page }) => {
    // The document panel should mount with its testid
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    // The "Document" heading inside the panel
    await expect(page.getByText("Document")).toBeVisible({ timeout: 10000 });

    // Character count starts at 0
    await expect(
      page.locator('[data-testid="document-char-count"]'),
    ).toHaveText("0 chars", { timeout: 10000 });

    // The sidebar chat input should be present
    await expect(
      page.getByPlaceholder("Ask me to write something..."),
    ).toBeVisible({ timeout: 10000 });
  });

  test("empty state shows placeholder text", async ({ page }) => {
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    // When no document has been streamed, the placeholder italic text shows
    await expect(
      page.getByText("Ask the agent to write something"),
    ).toBeVisible({ timeout: 10000 });

    // document-content testid should NOT be present in the empty state
    await expect(
      page.locator('[data-testid="document-content"]'),
    ).not.toBeVisible();
  });

  test("starter suggestions render in the sidebar", async ({ page }) => {
    // The suggestions defined in suggestions.ts should appear as buttons
    for (const title of [
      "Write a short poem",
      "Draft an email",
      "Explain quantum computing",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("sending a message triggers document streaming", async ({ page }) => {
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    // Send a message via the sidebar
    const input = page.getByPlaceholder("Ask me to write something...");
    await input.fill("Write a short poem about autumn leaves.");
    await input.press("Enter");

    // The document-content area should appear as the agent streams tokens
    await expect(page.locator('[data-testid="document-content"]')).toBeVisible({
      timeout: 60000,
    });

    // Content should have meaningful length (not empty)
    const content = page.locator('[data-testid="document-content"]');
    await expect(async () => {
      const text = await content.textContent();
      expect(text!.length).toBeGreaterThan(10);
    }).toPass({ timeout: 60000 });
  });

  test("character count updates as document streams", async ({ page }) => {
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    const charCount = page.locator('[data-testid="document-char-count"]');
    await expect(charCount).toHaveText("0 chars");

    // Send a message to trigger streaming
    const input = page.getByPlaceholder("Ask me to write something...");
    await input.fill("Write a short poem about autumn leaves.");
    await input.press("Enter");

    // Wait for char count to increase above 0
    await expect(async () => {
      const text = await charCount.textContent();
      const count = parseInt(text!.replace(/\D/g, ""), 10);
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 60000 });
  });

  test("live badge appears while agent is streaming", async ({ page }) => {
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    // No live badge before we send anything
    await expect(
      page.locator('[data-testid="document-live-badge"]'),
    ).not.toBeVisible();

    // Send a message to trigger streaming
    const input = page.getByPlaceholder("Ask me to write something...");
    await input.fill("Write a short poem about autumn leaves.");
    await input.press("Enter");

    // The LIVE badge should appear while the agent is running
    await expect(
      page.locator('[data-testid="document-live-badge"]'),
    ).toBeVisible({ timeout: 60000 });
  });

  test("assistant responds in the sidebar chat", async ({ page }) => {
    await expect(page.locator('[data-testid="document-view"]')).toBeVisible({
      timeout: 15000,
    });

    const input = page.getByPlaceholder("Ask me to write something...");
    await input.fill("Write a short poem about autumn leaves.");
    await input.press("Enter");

    // The sidebar should show an assistant message
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
