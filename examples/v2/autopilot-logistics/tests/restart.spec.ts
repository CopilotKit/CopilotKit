import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

test("committed SQL data remains visible after a separate app start", async ({
  page,
}) => {
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const order = database
    .prepare(
      "SELECT id, reference, customer, destination, status FROM orders WHERE customer LIKE 'Cobalt Test %' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as
    | {
        id: string;
        reference: string;
        customer: string;
        destination: string;
        status: string;
      }
    | undefined;
  expect(order).toBeTruthy();
  const user = database
    .prepare(
      "SELECT display_name, role, active FROM users WHERE display_name LIKE 'Taylor Test %' ORDER BY rowid DESC LIMIT 1",
    )
    .get() as
    | { display_name: string; role: string; active: number }
    | undefined;
  expect(user).toBeTruthy();
  database.close();

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto(`/orders/${order!.id}`);
  await expect(
    page.getByRole("heading", { name: order!.reference }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Customer" })).toHaveValue(
    order!.customer,
  );
  await expect(page.getByRole("textbox", { name: "Destination" })).toHaveValue(
    order!.destination,
  );
  await page.goto("/users");
  await expect(page.getByText(user!.display_name)).toBeVisible();
});
