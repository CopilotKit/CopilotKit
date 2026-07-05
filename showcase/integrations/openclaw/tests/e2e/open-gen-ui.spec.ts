import { test, expect } from "@playwright/test";

// Behavioral e2e for the open-gen-ui demo (OpenClaw), run against aimock.
//
// This demo registers ONE frontend tool with a `render` function via
// `useFrontendTool`: `render_insight(title, summary, accent, metrics)`. The
// tool has no handler — its only job is to paint UI. When the OpenClaw agent
// calls `render_insight`, CopilotChat drives the render function through its
// inProgress -> executing -> complete lifecycle, and it paints an open-ended
// insight card from the arguments (insight-card.tsx):
//   data-testid="open-gen-ui-insight-card"   (outer, with data-accent / data-status)
//   data-testid="open-gen-ui-insight-title"
//   data-testid="open-gen-ui-metric-grid"
//
// The load-bearing assertion is that the rendered insight component appears —
// the generative UI is the tool's render output, not LLM text. Prompts match
// showcase/aimock/d4/openclaw/chat.json. The existing "returned:" terminator
// fixture closes the tool turn, so only the first-call tool fixture is needed.
test.describe("Open-Ended Generative UI (render_insight)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("page loads with chat input and insight suggestions", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Renewable energy mix",
      "Web vitals report",
      "Team velocity",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Renewable energy mix' pill renders an insight component", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Renewable energy mix" }).click();

    const card = page
      .locator('[data-testid="open-gen-ui-insight-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(
      card.locator('[data-testid="open-gen-ui-metric-grid"]'),
    ).toBeVisible();
  });

  test("'Web vitals report' pill renders an insight component", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Web vitals report" }).click();

    const card = page
      .locator('[data-testid="open-gen-ui-insight-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card).toHaveAttribute("data-accent", "emerald");
    await expect(
      card.locator('[data-testid="open-gen-ui-metric-grid"]'),
    ).toBeVisible();
  });

  test("typing an insight prompt renders an insight component", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Visualize the global renewable energy mix.");
    await input.press("Enter");

    const card = page
      .locator('[data-testid="open-gen-ui-insight-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(
      card.locator('[data-testid="open-gen-ui-insight-title"]'),
    ).toBeVisible();
  });
});
