import { expect, test } from "@playwright/test";
import { demoPath, integration, requireIntegration } from "./helpers";

// Checks of the app itself. They hold for every integration, so they run for
// any INTEGRATION.
test.describe("Showcase app", () => {
  test("the index page shows the integration", async ({ page }) => {
    const { name } = requireIntegration(integration);

    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
  });

  test("a demo path the integration does not serve answers 404", async ({
    request,
  }) => {
    const response = await request.get(demoPath("no-such-demo"));

    expect(response.status()).toBe(404);
  });
});
