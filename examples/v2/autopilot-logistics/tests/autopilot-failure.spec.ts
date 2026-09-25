import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("an interrupted assistant request leaves the manual app usable", async ({
  page,
}) => {
  test.setTimeout(45_000);
  const evidenceDir = evidencePath("iteration-040", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const customer = `Manual after outage ${Date.now()}`;
  let interruptedRequests = 0;
  const interruptedPaths: string[] = [];

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const runEndpoint = /\/api\/copilotkit\/agent\/[^/]+\/run$/;
  await page.route(runEndpoint, async (route) => {
    interruptedRequests++;
    interruptedPaths.push(new URL(route.request().url()).pathname);
    await route.abort("failed");
  });
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill("Read the current dashboard and tell me its first heading.");
  await page.locator(".assistant-panel button").last().click();
  await expect
    .poll(() => interruptedRequests, { timeout: 15_000 })
    .toBeGreaterThan(0);

  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/, { timeout: 10_000 });
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/orders\/new$/, { timeout: 10_000 });
  const form = page.getByRole("form", { name: "Create order" });
  await form.getByRole("textbox", { name: "Customer" }).fill(customer);
  await form.getByRole("textbox", { name: "Origin" }).fill("Portland");
  await form.getByRole("textbox", { name: "Destination" }).fill("Seattle");
  await form.getByLabel("Requested ship date").fill("2026-11-18");
  await form.getByLabel("Assigned operator").selectOption("operator");
  await form.getByLabel("Status").selectOption("booked");
  await form.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { name: /NS-/ })).toBeVisible();

  const row = database
    .prepare("SELECT customer, status, version FROM orders WHERE customer = ?")
    .get(customer) as { customer: string; status: string; version: number };
  expect(row).toEqual({ customer, status: "booked", version: 1 });
  writeFileSync(
    resolve(evidenceDir, "interrupted-paths.json"),
    JSON.stringify({ interruptedPaths }, null, 2),
  );
  expect(interruptedRequests).toBe(1);
  await page.screenshot({
    path: resolve(evidenceDir, "manual-after-outage.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "manual-after-outage.json"),
    JSON.stringify({ interruptedRequests, manualRow: row }, null, 2),
  );
  database.close();
});
