import { test, expect } from "@playwright/test";

// Behavioral e2e for the agentic-chat-reasoning demo, run against aimock.
// The OpenClaw gateway injects X-AIMock-Context: openclaw, so these prompts
// match the fixtures in showcase/aimock/d4/openclaw/chat.json. The reasoning
// fixtures also carry a `reasoning` field so REASONING_* events stream and the
// CopilotChat reasoning panel has content — but the load-bearing assertion is
// simply that an assistant message appears (reasoning rendering is best-effort).
test.describe("Agentic Chat (Reasoning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("page loads with a chat input and the starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Show reasoning", "Plan a trip", "Is 17 prime?"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("clicking the 'Show reasoning' pill produces an assistant response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Show reasoning" }).click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    // The sky-scattering fixture answer mentions Rayleigh scattering.
    await expect(page.getByText(/scatter/i).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("typing a reasoning prompt gets an assistant response", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Walk me through whether 17 is prime.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
