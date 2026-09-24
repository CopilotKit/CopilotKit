import { expect, test } from "@playwright/test";

test("client navigation renders the destination form", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByRole("form", { name: "Create order" })).toBeVisible();
});

test("unsaved order form can refuse a client navigation", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto("/orders/new");
  await page
    .getByRole("textbox", { name: "Customer" })
    .fill("Unsaved Northstar draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByRole("textbox", { name: "Customer" })).toHaveValue(
    "Unsaved Northstar draft",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
});
