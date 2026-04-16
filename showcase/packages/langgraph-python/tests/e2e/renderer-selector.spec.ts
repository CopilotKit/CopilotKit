import { test, expect } from "@playwright/test";

test.describe("Renderer Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with 4 renderer pills", async ({ page }) => {
    const pills = page.locator("[role='radio']");
    await expect(pills).toHaveCount(4);

    // Verify all strategy names are visible
    await expect(page.getByRole("radio", { name: /Tool-Based/ })).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /A2UI Catalog/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /json-render/ }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /HashBrown/ })).toBeVisible();
  });

  test("default selection is tool-based", async ({ page }) => {
    const toolBasedPill = page.getByRole("radio", { name: /Tool-Based/ });
    await expect(toolBasedPill).toHaveAttribute("aria-checked", "true");

    // All other pills should not be checked
    const a2uiPill = page.getByRole("radio", { name: /A2UI Catalog/ });
    await expect(a2uiPill).toHaveAttribute("aria-checked", "false");

    const hashbrownPill = page.getByRole("radio", { name: /HashBrown/ });
    await expect(hashbrownPill).toHaveAttribute("aria-checked", "false");
  });

  test("clicking a pill switches the active mode", async ({ page }) => {
    // Click on HashBrown
    const hashbrownPill = page.getByRole("radio", { name: /HashBrown/ });
    await hashbrownPill.click();
    await expect(hashbrownPill).toHaveAttribute("aria-checked", "true");

    // Tool-based should no longer be active
    const toolBasedPill = page.getByRole("radio", { name: /Tool-Based/ });
    await expect(toolBasedPill).toHaveAttribute("aria-checked", "false");
  });

  test("switching between multiple modes updates the active pill each time", async ({
    page,
  }) => {
    const modes = ["A2UI Catalog", "json-render", "HashBrown", "Tool-Based"];

    for (const modeName of modes) {
      const pill = page.getByRole("radio", { name: new RegExp(modeName) });
      await pill.click();
      await expect(pill).toHaveAttribute("aria-checked", "true");

      // All other pills should be unchecked
      for (const otherMode of modes) {
        if (otherMode !== modeName) {
          const otherPill = page.getByRole("radio", {
            name: new RegExp(otherMode),
          });
          await expect(otherPill).toHaveAttribute("aria-checked", "false");
        }
      }
    }
  });
});
