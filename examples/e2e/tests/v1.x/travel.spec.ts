import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("travel", () => {
  test.skip(EXAMPLE !== "travel", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    // Use domcontentloaded because the travel layout loads external CDN
    // resources (leaflet CSS/JS from unpkg) that are render-blocking.
    // The default "load" waitUntil hangs when unpkg is slow in CI.
    await page.goto("/?copilotOpen=false", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveTitle(/CopilotKit Travel/i);
  });
});
