import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for
// readonly-state-agent-context.
test.describe(
  "Readonly State (Agent Context) — canonical suggestion pill",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/demos/readonly-state-agent-context");
    });

    test("Recall pref suggestion pill fires the catalog prompt", async ({
      page,
    }) => {
      const pill = page
        .getByRole("button", { name: /Recall pref/i })
        .first();
      await expect(pill).toBeVisible({ timeout: 30_000 });
      await pill.click();
      await expect(
        page.getByText("recall the user preference"),
      ).toBeVisible({ timeout: 30_000 });
    });
  },
);
