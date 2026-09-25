import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

test("deactivating a user invalidates their existing session and stale form version", async ({
  page,
  browser,
}) => {
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  await page.goto("/sign-in");
  const id = crypto.randomUUID();
  const name = `Session Check ${Date.now()}`;
  const token = crypto.randomUUID();
  database
    .prepare(
      "INSERT INTO users(id, organization_id, display_name, role, active, version) VALUES (?, 'northstar', ?, 'operator', 1, 1)",
    )
    .run(id, name);
  database
    .prepare(
      "INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)",
    )
    .run(token, id, new Date(Date.now() + 3_600_000).toISOString());
  const target = await browser.newContext();
  await target.addCookies([
    { name: "northstar_session", value: token, url: "http://127.0.0.1:3000" },
  ]);
  const targetPage = await target.newPage();
  await targetPage.goto("/orders");
  await expect(
    targetPage.getByRole("heading", { name: "Orders" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto("/users");
  const form = page.getByRole("form", { name: `Edit user ${name}` });
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "Deactivate" }).click();
  await expect
    .poll(
      () =>
        (
          database.prepare("SELECT active FROM users WHERE id = ?").get(id) as {
            active: number;
          }
        ).active,
    )
    .toBe(0);
  expect(
    database.prepare("SELECT active, version FROM users WHERE id = ?").get(id),
  ).toMatchObject({ active: 0, version: 2 });
  expect(
    database
      .prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?")
      .get(id),
  ).toMatchObject({ count: 0 });
  await targetPage.reload();
  await expect(targetPage).toHaveURL(/\/sign-in$/);
  const stale = await page.request.post("/api/users", {
    form: {
      action: "update",
      id,
      displayName: name,
      role: "viewer",
      version: "1",
      operationKey: crypto.randomUUID(),
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(stale.status()).toBe(409);
  await target.close();
});
