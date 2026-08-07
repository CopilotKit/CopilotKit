import { test, expect } from "@playwright/test";

// Behavioral e2e for the agent-config demo, run against aimock (deterministic
// LLM). The gateway injects X-AIMock-Context: openclaw, so these prompts match
// the fixtures in showcase/aimock/d4/openclaw/chat.json. The demo forwards the
// selected tone / expertise / response-length to the OpenClaw agent via
// useAgentContext (ag-ui appends it to the prompt); the fixtures return the
// text the agent produces while respecting that config.
test.describe("Agent Config", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("renders the config card with tone, expertise, and length selects", async ({
    page,
  }) => {
    await expect(page.getByTestId("agent-config-card")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId("agent-config-tone-select")).toBeVisible();
    await expect(
      page.getByTestId("agent-config-expertise-select"),
    ).toBeVisible();
    await expect(page.getByTestId("agent-config-length-select")).toBeVisible();
  });

  test("config selects update to the chosen values", async ({ page }) => {
    await page
      .getByTestId("agent-config-tone-select")
      .selectOption("enthusiastic");
    await expect(page.getByTestId("agent-config-tone-select")).toHaveValue(
      "enthusiastic",
    );

    await page
      .getByTestId("agent-config-expertise-select")
      .selectOption("expert");
    await expect(page.getByTestId("agent-config-expertise-select")).toHaveValue(
      "expert",
    );

    await page
      .getByTestId("agent-config-length-select")
      .selectOption("detailed");
    await expect(page.getByTestId("agent-config-length-select")).toHaveValue(
      "detailed",
    );
  });

  test("sends a message and the agent responds respecting the config", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Explain what an API is.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/API/i).last()).toBeVisible({ timeout: 30000 });
  });

  test("after changing the config, a follow-up message still gets a response", async ({
    page,
  }) => {
    await page
      .getByTestId("agent-config-tone-select")
      .selectOption("enthusiastic");
    await page
      .getByTestId("agent-config-expertise-select")
      .selectOption("beginner");

    const input = page.getByRole("textbox").first();
    await input.fill("Introduce yourself.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
