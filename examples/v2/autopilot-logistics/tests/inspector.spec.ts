import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { evidencePath } from "./evidence";

test("production Inspector opens on the local app with runtime and Intelligence status", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const inspector = page.locator("cpk-web-inspector");
  await expect(inspector).toBeAttached();
  await page.getByRole("button", { name: "Web Inspector" }).click();
  await expect(page.getByText("System Health")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Intelligence" }),
  ).toBeVisible();
  await expect(page.getByText("Frontend Tools", { exact: true })).toBeVisible();
  const dir = evidencePath("iteration-021", String(Date.now()));
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, "inspector-production.png"),
    fullPage: true,
  });
});
