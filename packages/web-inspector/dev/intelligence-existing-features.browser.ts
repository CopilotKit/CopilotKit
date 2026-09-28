import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Uses the real Inspector and legacy fixtures with a separate product document. */
async function setup(page: Page, scenario: string) {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><title>Product view</title><h1>Product view</h1></html>',
    }),
  );
  await page.goto(
    `/?scenario=${scenario}&reset=1&intelligenceAppUrl=https%3A%2F%2Fintelligence.example%2Finspector.html`,
  );
  return page.locator("cpk-web-inspector");
}

test("new product panes preserve the selected legacy thread and its event timeline", async ({
  page,
}) => {
  const inspector = await setup(page, "pro-enabled-existing");
  await inspector.locator('[data-inspector-menu-key="threads"]').click();
  const selected = inspector.getByRole("button", {
    name: /Inspector launch review/,
  });
  await selected.click();
  await expect(
    inspector.getByText("This response came from the local scenario lab.", {
      exact: true,
    }),
  ).toBeVisible();

  for (const [key, title] of [
    ["analytics", "Analytics"],
    ["governance", "Governance"],
  ]) {
    await inspector.locator(`[data-inspector-menu-key="${key}"]`).click();
    await expect(
      inspector
        .frameLocator(`iframe[title="${title}"]`)
        .getByRole("heading", { name: "Product view", exact: true }),
    ).toBeVisible();
    await inspector.locator('[data-inspector-menu-key="threads"]').click();
    await expect(selected).toHaveAttribute("aria-current", "true");
    await expect(
      inspector.getByText("This response came from the local scenario lab.", {
        exact: true,
      }),
    ).toBeVisible();
  }
  await inspector
    .getByRole("button", { name: "Show event timeline", exact: true })
    .click();

  await expect(
    inspector.getByRole("button", { name: "Show conversation", exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByText("Local scenario detail event", { exact: true }),
  ).toBeVisible();
  for (const key of ["playground", "agents", "ag-ui-events", "agent-context"])
    await expect(
      inspector.locator(`[data-inspector-menu-key="${key}"]`),
    ).toBeVisible();
});

test("embedded Learning remains an addition to the original Automatic Learning workbench", async ({
  page,
}) => {
  const inspector = await setup(page, "learning-success");
  await inspector.locator('[data-inspector-menu-key="memories"]').click();
  const views = inspector.getByLabel("Learning views");
  await views.getByRole("button", { name: "Workbench", exact: true }).click();
  await expect(inspector.locator("cpk-learning-view")).toBeVisible();
  await expect(
    inspector.getByText("verify-refund-request", { exact: true }),
  ).toBeVisible();

  await views
    .getByRole("button", { name: "Insights & Skills", exact: true })
    .click();
  await expect(
    inspector
      .frameLocator('iframe[title="Learning"]')
      .getByRole("heading", { name: "Product view", exact: true }),
  ).toBeVisible();
  await views.getByRole("button", { name: "Workbench", exact: true }).click();

  await expect(inspector.locator("cpk-learning-view")).toBeVisible();
  await expect(
    inspector.getByText("verify-refund-request", { exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", {
      name: "Verify the order before giving refund guidance. 12 Threads",
      exact: true,
    }),
  ).toBeVisible();
});
