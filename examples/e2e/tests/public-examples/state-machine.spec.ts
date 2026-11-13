import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("state-machine", () => {
  test.skip(EXAMPLE !== "state-machine", `EXAMPLE=${EXAMPLE}`);

  test("loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Orders" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "State Visualizer" }),
    ).toBeVisible();
    const grid = page
      .locator(".grid")
      .filter({
        has: page.getByRole("button", { name: "Orders", exact: true }),
      })
      .first();
    const panes = grid.locator(":scope > div");
    const left = await panes.nth(0).boundingBox();
    const right = await panes.nth(1).boundingBox();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    if (!left || !right) throw new Error("Missing order or chat pane");
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
    expect(right.width / left.width).toBeCloseTo(1.5, 1);
  });
});
