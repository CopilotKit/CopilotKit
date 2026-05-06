import { test, expect } from "@playwright/test";
import { frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "gen-ui-agent";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders without errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`/demos/${fw}/${DEMO}`);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      expect(errors).toEqual([]);
    });

    test("chat message list container is visible", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="copilot-message-list"]'),
      ).toBeVisible({ timeout: 15_000 });
    });
  });
}
