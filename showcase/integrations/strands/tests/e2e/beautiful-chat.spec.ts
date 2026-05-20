import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("page loads with heading and chat", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Beautiful Chat" }),
    ).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });

  // Regression: the broad `userMessage: "hi"` aimock fixture used to
  // hijack the Tokyo suggestion (substring "hi" matches "arc**hi**tecture")
  // and return a generic "Hi there! I'm your showcase assistant..."
  // greeting. The Plan/RAG/Email fixture trio added in the same PR as this
  // test was inserted before the broad "hi" matcher in feature-parity.json
  // so first-match-wins routes each suggestion to its on-topic response.
  // If a future fixture re-broadens or re-orders, these tests fail loudly.

  test("'Plan a 3-day Tokyo trip' returns a 3-day itinerary", async ({
    page,
  }) => {
    const input = page.getByTestId("copilot-chat-textarea");
    await input.fill(
      "Plan a 3-day Tokyo trip for a solo traveler interested in food, art, and architecture. Keep it concise.",
    );
    await input.press("Enter");

    const assistant = page
      .locator('[data-role="assistant"]')
      .filter({ hasText: /Day 1|Day 2|Day 3/i })
      .first();
    await expect(assistant).toBeVisible({ timeout: 60000 });

    // The hijacked greeting must be absent.
    await expect(page.getByText(/I'm your showcase assistant/i)).toHaveCount(0);
  });

  test("'Explain RAG like I'm 12' returns the analogy", async ({ page }) => {
    const input = page.getByTestId("copilot-chat-textarea");
    await input.fill(
      "Explain retrieval-augmented generation as if I were 12. Use a simple analogy.",
    );
    await input.press("Enter");

    const assistant = page
      .locator('[data-role="assistant"]')
      .filter({ hasText: /open-book|retrieval|RAG/i })
      .first();
    await expect(assistant).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/I'm your showcase assistant/i)).toHaveCount(0);
  });

  test("'Draft a launch email' returns the email", async ({ page }) => {
    const input = page.getByTestId("copilot-chat-textarea");
    await input.fill(
      "Draft a short, upbeat launch email announcing a new AI-powered chat feature. 3 short paragraphs max.",
    );
    await input.press("Enter");

    const assistant = page
      .locator('[data-role="assistant"]')
      .filter({ hasText: /Subject:|co-pilot|launch/i })
      .first();
    await expect(assistant).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(/I'm your showcase assistant/i)).toHaveCount(0);
  });
});
