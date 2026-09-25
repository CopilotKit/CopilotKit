import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

test("an unbound programmatic cancel click cannot become a manual approval", async ({
  page,
}) => {
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-BOUNDARY-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Boundary Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const status = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto(`/orders/${id}`);
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.accept();
  });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === "Cancel order",
    );
    button?.click();
  });
  await expect(page.getByTestId("copilot-approval")).toHaveCount(0);
  expect(dialogs).toBe(0);
  expect(status()).toEqual({ status: "booked", version: 1 });
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect.poll(() => dialogs).toBe(1);
  await expect.poll(() => status().status).toBe("cancelled");
  expect(status()).toEqual({ status: "cancelled", version: 2 });
});
