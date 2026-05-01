import { test, expect } from "@playwright/test";

// E2E smoke for the readonly-state-agent-context demo (AWS Strands showcase).
//
// This is intentionally a page-load smoke test. The Strands package reuses a
// single shared backend agent across every demo, so the per-demo coverage is
// behavioral (see the corresponding LangGraph-Python spec for the full
// interaction flow). This spec asserts the page mounts and the CopilotKit
// provider initializes without throwing.

test("readonly-state-agent-context loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/demos/readonly-state-agent-context");

  // Wait for React to hydrate by waiting for the body to be attached.
  await page.waitForLoadState("domcontentloaded");

  expect(
    errors,
    `page errors on /demos/readonly-state-agent-context: ${errors.join(" | ")}`,
  ).toEqual([]);
});

test("canonical suggestion pill fires the feature", async ({ page }) => {
  await page.goto("/demos/readonly-state-agent-context");
  const pill = page.getByRole("button", { name: /Recall pref/i }).first();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  await expect(
    page.locator('[data-testid="copilot-suggestion"]').first(),
  ).toBeVisible({ timeout: 60_000 });
});
