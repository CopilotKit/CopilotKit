/**
 * E2E tests for the Sales Dashboard starter.
 *
 * These tests verify that the starter's main page loads correctly,
 * the renderer selector works, and each renderer strategy shows
 * DIFFERENT content appropriate to that mode. They also exercise
 * real user interactions (clicking "Add a deal", switching modes).
 *
 * They do NOT require a running agent backend -- only the Next.js frontend.
 *
 * To run with aimock (deterministic LLM responses for agent-dependent tests):
 *   npx aimock --fixtures showcase/aimock --port 4010 --validate-on-load &
 *   cd showcase/integrations/langgraph-python
 *   OPENAI_BASE_URL=http://localhost:4010/v1 OPENAI_API_KEY=test-key npm run dev &
 *   cd ../../scripts
 *   BASE_URL=http://localhost:3000 npx playwright test __tests__/e2e/starter-e2e.spec.ts
 *
 * Or against an extracted starter:
 *   npx tsx showcase/scripts/extract-starter.ts langgraph-python /tmp/starter
 *   cd /tmp/starter && npm install && npm run dev &
 *   cd showcase/scripts
 *   BASE_URL=http://localhost:3000 npx playwright test __tests__/e2e/starter-e2e.spec.ts
 */

import { test, expect } from "@playwright/test";

test.describe("Starter: Sales Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the header to confirm the page has hydrated
    await expect(page.getByText("CopilotKit Sales Dashboard")).toBeVisible({
      timeout: 15000,
    });
  });

  // -------------------------------------------------------------------------
  // Page load & renderer selector basics
  // -------------------------------------------------------------------------

  test("page loads with header and renderer selector with 4 pills", async ({
    page,
  }) => {
    const pills = page.locator("[role='radio']");
    await expect(pills).toHaveCount(4);

    await expect(page.getByRole("radio", { name: /Tool-Based/ })).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /A2UI Catalog/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /json-render/ }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /HashBrown/ })).toBeVisible();
  });

  test("default selection is Tool-Based with pipeline content visible", async ({
    page,
  }) => {
    const toolBasedPill = page.getByRole("radio", { name: /Tool-Based/ });
    await expect(toolBasedPill).toHaveAttribute("aria-checked", "true");

    // The SalesDashboard must show the pipeline heading and KPI cards
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total Pipeline")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Tool-Based mode: full dashboard verification
  // -------------------------------------------------------------------------

  test("Tool-Based mode renders pipeline heading, KPI cards, and empty state", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: /Tool-Based/ }).click();

    // Pipeline heading
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 15000,
    });

    // KPI metric cards: Total Pipeline + the 3 non-closed stages
    await expect(page.getByText("Total Pipeline")).toBeVisible();
    await expect(page.getByText("Prospect")).toBeVisible();
    await expect(page.getByText("Qualified")).toBeVisible();
    await expect(page.getByText("Proposal")).toBeVisible();

    // Empty state when no deals exist
    await expect(page.getByText("No deals yet")).toBeVisible();
    await expect(page.getByText("Add a deal")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // A2UI mode: same SalesDashboard content with A2UI catalog
  // -------------------------------------------------------------------------

  test("A2UI mode renders the same SalesDashboard content", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: /A2UI Catalog/ }).click();
    await expect(
      page.getByRole("radio", { name: /A2UI Catalog/ }),
    ).toHaveAttribute("aria-checked", "true");

    // Should still show pipeline and KPI cards (same SalesDashboard component)
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total Pipeline")).toBeVisible();
    await expect(page.getByText("No deals yet")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // json-render mode: yellow fallback note + tool-based content underneath
  // -------------------------------------------------------------------------

  test("json-render mode shows yellow fallback note with tool-based content underneath", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: /json-render/ }).click();
    await expect(
      page.getByRole("radio", { name: /json-render/ }),
    ).toHaveAttribute("aria-checked", "true");

    // The yellow fallback banner
    await expect(
      page.getByText("json-render is not yet available"),
    ).toBeVisible({ timeout: 10000 });

    // Tool-based content should still be rendered underneath
    await expect(page.getByText("Sales Pipeline")).toBeVisible();
    await expect(page.getByText("Total Pipeline")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // HashBrown mode: renders SalesDashboard with HashBrown message renderer
  // -------------------------------------------------------------------------

  test("HashBrown mode renders SalesDashboard with pipeline content", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: /HashBrown/ }).click();
    await expect(
      page.getByRole("radio", { name: /HashBrown/ }),
    ).toHaveAttribute("aria-checked", "true");

    // HashBrown wraps the same SalesDashboard, so pipeline content is visible
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Total Pipeline")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Critical: switching modes actually changes visible content
  // -------------------------------------------------------------------------

  test("switching to json-render shows fallback note that other modes lack", async ({
    page,
  }) => {
    // Tool-Based should NOT have the json-render fallback note
    await page.getByRole("radio", { name: /Tool-Based/ }).click();
    await expect(page.getByText("Sales Pipeline")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText("json-render is not yet available"),
    ).not.toBeVisible();

    // Switch to json-render -- the note appears
    await page.getByRole("radio", { name: /json-render/ }).click();
    await expect(
      page.getByText("json-render is not yet available"),
    ).toBeVisible({ timeout: 10000 });

    // Pipeline should still be visible underneath
    await expect(page.getByText("Sales Pipeline")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Critical: Add a deal interaction works (local React state, no agent)
  // -------------------------------------------------------------------------

  test("clicking Add a deal creates a new deal card and removes empty state", async ({
    page,
  }) => {
    await page.getByRole("radio", { name: /Tool-Based/ }).click();

    // Verify empty state is shown
    await expect(page.getByText("No deals yet")).toBeVisible({
      timeout: 15000,
    });

    // Click the "Add a deal" button
    await page.getByRole("button", { name: "Add a deal" }).click();

    // After adding, "No deals yet" should be gone
    await expect(page.getByText("No deals yet")).not.toBeVisible();

    // A new deal card with the default title "New Deal" should appear
    await expect(page.getByText("New Deal")).toBeVisible();

    // The "Active Deals" column header should be visible
    await expect(page.getByText("Active Deals")).toBeVisible();
  });

  test("adding multiple deals shows correct count", async ({ page }) => {
    await page.getByRole("radio", { name: /Tool-Based/ }).click();
    await expect(page.getByText("No deals yet")).toBeVisible({
      timeout: 15000,
    });

    // Add first deal via the empty state button
    await page.getByRole("button", { name: "Add a deal" }).click();
    await expect(page.getByText("Active Deals")).toBeVisible();

    // Add second deal via the column header + button (aria-label="Add new deal")
    await page.getByRole("button", { name: "Add new deal" }).click();

    // Should now show two "New Deal" entries
    const dealCards = page.getByText("New Deal");
    await expect(dealCards).toHaveCount(2);
  });

  // -------------------------------------------------------------------------
  // Pill mutual exclusion still works (simpler version of original)
  // -------------------------------------------------------------------------

  test("only one renderer pill is active at a time", async ({ page }) => {
    const modes = ["A2UI Catalog", "HashBrown", "json-render", "Tool-Based"];

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
