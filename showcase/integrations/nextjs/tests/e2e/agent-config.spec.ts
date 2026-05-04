import { test, expect } from "@playwright/test";
import { frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "agent-config";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders config card", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="agent-config-card"]'),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("config selects are present with default values", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="agent-config-tone-select"]'),
      ).toHaveValue("professional", { timeout: 15_000 });
      await expect(
        page.locator('[data-testid="agent-config-expertise-select"]'),
      ).toHaveValue("intermediate");
      await expect(
        page.locator('[data-testid="agent-config-length-select"]'),
      ).toHaveValue("concise");
    });
  });
}
