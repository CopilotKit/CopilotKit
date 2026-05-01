import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for
// tool-rendering-reasoning-chain.
test.describe(
  "Tool Rendering (Reasoning Chain) — canonical suggestion pill",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/demos/tool-rendering-reasoning-chain");
    });

    test("Kyoto itinerary suggestion pill fires the catalog prompt", async ({
      page,
    }) => {
      const pill = page
        .getByRole("button", { name: /Kyoto itinerary/i })
        .first();
      await expect(pill).toBeVisible({ timeout: 30_000 });
      await pill.click();
      await expect(
        page.getByText("draft a 3-day kyoto itinerary with a 1500 dollar budget"),
      ).toBeVisible({ timeout: 30_000 });
    });
  },
);
