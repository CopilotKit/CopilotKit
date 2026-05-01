import { test, expect } from "@playwright/test";

// E2E smoke for the headless-simple demo (AWS Strands showcase).
//
// This is intentionally a page-load smoke test. The Strands package reuses a
// single shared backend agent across every demo, so the per-demo coverage is
// behavioral (see the corresponding LangGraph-Python spec for the full
// interaction flow). This spec asserts the page mounts and the CopilotKit
// provider initializes without throwing.

test("headless-simple loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/headless-simple");

  // Wait for React to hydrate by waiting for the body to be attached.
  await page.waitForLoadState("domcontentloaded");

  expect(
    errors,
    `page errors on /demos/headless-simple: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion prompt fires the feature", async ({ page }) => {
  await page.goto("/demos/headless-simple");
  const input = page
    .getByPlaceholder(/Type a message\. Ask me to 'show a card about cats'\./i)
    .first();
  await input.fill("show a small card body about hummingbirds");
  await input.press("Enter");
  await expect(
    page.locator('[data-message-role="assistant"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
