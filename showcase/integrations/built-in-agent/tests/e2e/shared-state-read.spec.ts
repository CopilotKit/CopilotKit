import { test, expect } from "@playwright/test";

// The built-in-agent column ships ONE shared-state demo page that exercises
// both read and write paths (`/demos/shared-state-read-write`). The
// per-package baseline expects separate `shared-state-read` + `shared-state-write`
// specs (see showcase/packages/langgraph-typescript), so we split the smoke
// across two spec files that point at the same page but assert different
// surfaces — this one checks the read side (recipe rendered from agent state).
test("shared-state-read: recipe state renders from agent state", async ({
  page,
}) => {
  await page.goto("/demos/shared-state-read-write");
  await expect(
    page.getByRole("heading", { name: /shared state/i }),
  ).toBeVisible();
  await expect(page.getByText("Ingredients")).toBeVisible();
  await expect(page.getByText("Steps")).toBeVisible();
});
