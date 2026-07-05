import { test, expect } from "@playwright/test";

// Behavioral e2e for the headless-complete demo, run against aimock (a
// deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so these
// prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// The demo is a hand-rolled CopilotChat replacement built on `useAgent`, so
// assertions target the demo's own bubbles (data-testid="headless-message-*")
// rather than any CopilotChat markup.
test.describe("Headless UI: Complete", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with a composer and starter suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    // Empty-state sample prompts are rendered as buttons.
    await expect(
      page.getByRole("button", { name: "Try suggestion: Introduce yourself." }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("sends a typed message and renders the assistant reply", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Introduce yourself.");
    await input.press("Enter");

    // The user bubble should appear...
    await expect(
      page.locator('[data-testid="headless-message-user"]').first(),
    ).toBeVisible({ timeout: 30000 });

    // ...and the assistant reply should render in a headless bubble.
    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: 30000 });
    await expect(assistant).toContainText(/OpenClaw/i, { timeout: 30000 });
  });

  test("renders the render_chart tool call as a chart card", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="headless-chart-card"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Quarterly Sales/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test("renders the highlight_note frontend tool inline", async ({ page }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Highlight this note for me: 'ship the demo on Friday'.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="headless-highlight-card"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/ship the demo on Friday/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test("shows the reasoning chain for a step-by-step prompt", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Explain step by step why the sky appears blue");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="headless-message-reasoning"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.locator('[data-testid="headless-message-assistant"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
