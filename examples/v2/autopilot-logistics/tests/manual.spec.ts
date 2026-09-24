import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("manual order and user workflows persist and enforce roles", async ({
  page,
}) => {
  const evidenceDir = resolve(
    process.cwd(),
    "../../../.context/autopilot-evidence/iteration-004",
    String(Date.now()),
  );
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const customer = `Cobalt Test ${Date.now()}`;
  const initial = database
    .prepare("SELECT count(*) AS count FROM orders WHERE customer = ?")
    .get(customer) as { count: number };
  expect(initial.count).toBe(0);

  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await page.goto("/orders/new");
  const form = page.getByRole("form", { name: "Create order" });
  await form.getByRole("textbox", { name: "Customer" }).fill(customer);
  await form
    .getByRole("textbox", { name: "Origin" })
    .fill("10 Example Street, Portland, OR");
  await form
    .getByRole("textbox", { name: "Destination" })
    .fill("20 Sample Street, Seattle, WA");
  await form.getByLabel("Requested ship date").fill("2026-11-18");
  await form.getByLabel("Service level").selectOption("express");
  await form.getByLabel("Assigned operator").selectOption("operator");
  await form.getByLabel("Status").selectOption("booked");
  await form
    .getByRole("textbox", { name: "Notes" })
    .fill("Leave at receiving desk.");
  const createKey = await form
    .locator('input[name="operationKey"]')
    .inputValue();
  await form.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { name: /NS-/ })).toBeVisible();
  const orderRow = database
    .prepare(
      "SELECT id, reference, destination, service_level, status, version FROM orders WHERE customer = ?",
    )
    .get(customer) as {
    id: string;
    reference: string;
    destination: string;
    service_level: string;
    status: string;
    version: number;
  };
  expect(orderRow).toMatchObject({
    destination: "20 Sample Street, Seattle, WA",
    service_level: "express",
    status: "booked",
    version: 1,
  });
  const originalPayload = {
    operationKey: createKey,
    customer,
    origin: "10 Example Street, Portland, OR",
    destination: "20 Sample Street, Seattle, WA",
    shipDate: "2026-11-18",
    serviceLevel: "express",
    assignedUserId: "operator",
    status: "booked",
    notes: "Leave at receiving desk.",
  };
  const replay = await page.request.post("/api/orders", {
    form: originalPayload,
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).id).toBe(orderRow.id);
  const changedReplay = await page.request.post("/api/orders", {
    form: { ...originalPayload, customer: "Changed identity" },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(changedReplay.status()).toBe(409);
  expect(
    (
      database
        .prepare("SELECT count(*) AS count FROM orders WHERE customer = ?")
        .get(customer) as { count: number }
    ).count,
  ).toBe(1);
  await page.screenshot({
    path: resolve(evidenceDir, "created-order.png"),
    fullPage: true,
  });

  const edit = page.getByRole("form", {
    name: `Edit order ${orderRow.reference}`,
  });
  await edit
    .getByRole("textbox", { name: "Destination" })
    .fill("30 Changed Avenue, Seattle, WA");
  await edit.getByLabel("Status").selectOption("in_transit");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Version 2")).toBeVisible();
  const edited = database
    .prepare("SELECT destination, status, version FROM orders WHERE id = ?")
    .get(orderRow.id);
  expect(edited).toMatchObject({
    destination: "30 Changed Avenue, Seattle, WA",
    status: "in_transit",
    version: 2,
  });
  const stale = await page.request.post(`/api/orders/${orderRow.id}`, {
    form: {
      ...originalPayload,
      operationKey: crypto.randomUUID(),
      action: "update",
      version: "1",
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(stale.status()).toBe(409);
  await page.screenshot({
    path: resolve(evidenceDir, "edited-order.png"),
    fullPage: true,
  });

  // A dispatched shipment cannot be cancelled, including by a direct endpoint call.
  const forbidden = await page.request.post(`/api/orders/${orderRow.id}`, {
    form: { action: "cancel", version: "2", operationKey: crypto.randomUUID() },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(forbidden.status()).toBe(409);
  expect(
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(orderRow.id),
  ).toMatchObject({ status: "in_transit", version: 2 });

  await page.getByRole("link", { name: "Orders", exact: true }).click();
  const cancelCandidate = database
    .prepare(
      "SELECT reference, version FROM orders WHERE organization_id = 'northstar' AND status = 'booked' ORDER BY reference LIMIT 1",
    )
    .get() as { reference: string; version: number };
  await page.getByRole("link", { name: cancelCandidate.reference }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(
    page.getByText(`Version ${cancelCandidate.version + 1}`),
  ).toBeVisible();
  expect(
    database
      .prepare("SELECT status, version FROM orders WHERE reference = ?")
      .get(cancelCandidate.reference),
  ).toMatchObject({
    status: "cancelled",
    version: cancelCandidate.version + 1,
  });

  await page.getByRole("link", { name: "Users", exact: true }).click();
  const userForm = page.locator(".user-card").first().locator("form");
  const newUser = `Taylor Test ${Date.now()}`;
  await userForm.getByRole("textbox", { name: "Display name" }).fill(newUser);
  await userForm.getByLabel("Role").selectOption("viewer");
  await userForm.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByText(newUser)).toBeVisible();
  const userRow = database
    .prepare("SELECT id, role, active FROM users WHERE display_name = ?")
    .get(newUser) as { id: string; role: string; active: number };
  expect(userRow).toMatchObject({ role: "viewer", active: 1 });
  const personForm = page
    .locator(".user-row")
    .filter({ hasText: newUser })
    .locator("form");
  await personForm.getByLabel("Role").selectOption("operator");
  await personForm.getByRole("button", { name: "Save user" }).click();
  await expect
    .poll(
      () =>
        (
          database
            .prepare("SELECT role FROM users WHERE id = ?")
            .get(userRow.id) as { role: string }
        ).role,
    )
    .toBe("operator");
  page.once("dialog", (dialog) => dialog.accept());
  await personForm.getByRole("button", { name: "Deactivate" }).click();
  await expect
    .poll(
      () =>
        (
          database
            .prepare("SELECT active FROM users WHERE id = ?")
            .get(userRow.id) as { active: number }
        ).active,
    )
    .toBe(0);
  await page.screenshot({
    path: resolve(evidenceDir, "users.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: /Sam Rivera/ }).click();
  await page.goto(`/orders/${orderRow.id}`);
  await expect(page.getByText("read-only for your account")).toBeVisible();
  const denied = await page.request.post(`/api/orders/${orderRow.id}`, {
    form: { action: "cancel", version: "2", operationKey: crypto.randomUUID() },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(denied.status()).toBe(403);
  const deniedUser = await page.request.post("/api/users", {
    form: {
      action: "create",
      displayName: "Forbidden User",
      role: "viewer",
      operationKey: crypto.randomUUID(),
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(deniedUser.status()).toBe(403);
  const otherOrder = database
    .prepare("SELECT id FROM orders WHERE organization_id = 'other-co' LIMIT 1")
    .get() as { id: string };
  await page.goto(`/orders/${otherOrder.id}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  const leak = await page.content();
  expect(leak).not.toContain("CANARY-NORTHSTAR-PRIVATE-7Q4M");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  const operatorUserWrite = await page.request.post("/api/users", {
    form: {
      action: "create",
      displayName: "Forbidden Operator User",
      role: "viewer",
      operationKey: crypto.randomUUID(),
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(operatorUserWrite.status()).toBe(403);
  const crossOrigin = await page.request.post("/api/orders", {
    form: { ...originalPayload, operationKey: crypto.randomUUID() },
    headers: { Origin: "https://untrusted.example" },
  });
  expect(crossOrigin.status()).toBe(403);

  writeFileSync(
    resolve(evidenceDir, "manual.json"),
    JSON.stringify(
      {
        customer,
        order: orderRow.id,
        created: orderRow,
        edited,
        replayStatus: replay.status(),
        changedReplayStatus: changedReplay.status(),
        staleStatus: stale.status(),
        forbiddenStatus: forbidden.status(),
        cancelledReference: cancelCandidate.reference,
        newUser,
        viewerWriteStatus: denied.status(),
        viewerUserWriteStatus: deniedUser.status(),
        operatorUserWriteStatus: operatorUserWrite.status(),
        crossOriginStatus: crossOrigin.status(),
        crossTenantDetailStatus: 404,
        privateCanaryInHtml: false,
      },
      null,
      2,
    ),
  );
  database.close();
});
