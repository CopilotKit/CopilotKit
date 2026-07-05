import { test, expect } from "@playwright/test";

// Behavioral e2e for the headless-simple demo, run against aimock (deterministic
// LLM). The gateway injects X-AIMock-Context: openclaw, so these prompts match
// the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// This is the headless (bring-your-own-UI) chat: no prebuilt CopilotChat, just
// useAgent + useCopilotKit wired into hand-rolled components. So we drive the
// custom composer (data-testid="headless-input") and assert the custom
// assistant bubble (data-testid="headless-message-assistant") renders.
test.describe("Headless Simple", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with the composer and three sample prompts", async ({
    page,
  }) => {
    await expect(page.getByTestId("headless-input")).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Say hello in one short sentence.",
      "Tell me a one-line joke.",
      "Give me a fun fact.",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("typing a message renders the assistant reply", async ({ page }) => {
    const input = page.getByTestId("headless-input");
    await input.fill("Tell me a one-line joke.");
    await input.press("Enter");

    // The user bubble renders immediately from local state.
    await expect(page.getByTestId("headless-message-user").first()).toBeVisible({
      timeout: 15000,
    });

    // The assistant reply streams back from aimock and renders in the custom
    // bubble. "Tell me a one-line joke." maps to the deterministic "layers"
    // joke fixture, so we can assert the exact seeded text.
    await expect(
      page.getByTestId("headless-message-assistant").first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/layers/i)).toBeVisible({ timeout: 30000 });
  });

  test("clicking a sample prompt sends it and gets a reply", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Say hello in one short sentence." })
      .click();

    await expect(
      page.getByTestId("headless-message-assistant").first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
