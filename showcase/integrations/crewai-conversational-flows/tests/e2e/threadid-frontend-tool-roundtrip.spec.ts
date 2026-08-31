import { test, expect } from "@playwright/test";

// QA reference: qa/threadid-frontend-tool-roundtrip.md
// Demo source: src/app/demos/threadid-frontend-tool-roundtrip/page.tsx
//
// The source-level regression for ENT-658 lives in react-core. This smoke keeps
// the showcase demo route and generated-thread toggle covered without depending
// on fixture-driven tool execution in the standalone showcase package.

test.describe("Thread ID frontend-tool round trip", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/threadid-frontend-tool-roundtrip");
  });

  test("page loads with generated-thread mode selected", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.getByLabel("Explicit threadId")).not.toBeChecked();
    await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
      /SDK-generated thread/i,
    );

    await page.getByLabel("Explicit threadId").check();
    await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
      /explicit thread/i,
    );
  });
});
