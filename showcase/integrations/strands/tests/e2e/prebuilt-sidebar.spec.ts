import { test, expect } from "@playwright/test";

// E2E smoke for the prebuilt-sidebar demo (AWS Strands showcase).
//
// This is intentionally a page-load smoke test. The Strands package reuses a
// single shared backend agent across every demo, so the per-demo coverage is
// behavioral (see the corresponding LangGraph-Python spec for the full
// interaction flow). This spec asserts the page mounts and the CopilotKit
// provider initializes without throwing.

test("prebuilt-sidebar loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/prebuilt-sidebar");

  // Wait for React to hydrate by waiting for the body to be attached.
  await page.waitForLoadState("domcontentloaded");

  expect(
    errors,
    `page errors on /demos/prebuilt-sidebar: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/prebuilt-sidebar");
  const pill = page.getByRole("button", { name: /Sidebar hello/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-sidebar"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
