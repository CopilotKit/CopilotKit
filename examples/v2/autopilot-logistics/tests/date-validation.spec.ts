import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

test("invalid shipment date is rejected without changing the order", async ({
  page,
}) => {
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-DATE-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Date Demo Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  const response = await page.request.post(`/api/orders/${id}`, {
    form: {
      action: "update",
      operationKey: crypto.randomUUID(),
      version: "1",
      customer: "Date Demo Client",
      origin: "1 Sample Way, Portland, OR",
      destination: "2 Example Road, Seattle, WA",
      shipDate: "2026-02-30",
      serviceLevel: "standard",
      assignedUserId: "operator",
      status: "booked",
      notes: "",
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toMatch(/valid ship date/i);
  expect(
    database
      .prepare("SELECT ship_date, status, version FROM orders WHERE id = ?")
      .get(id),
  ).toMatchObject({ ship_date: "2026-11-18", status: "booked", version: 1 });
});
