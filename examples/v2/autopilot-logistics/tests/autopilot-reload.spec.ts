import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidencePath } from "./evidence";

test("reload while approval is pending restores the thread without replaying a write", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-RELOAD-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Reload Customer', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database.prepare("SELECT status, version FROM orders WHERE id = ?").get(id);
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await page
      .locator(".assistant-panel textarea")
      .last()
      .fill(
        `Find order ${reference}, open its detail page, and use the visible cancel action. I will review the approval.`,
      );
    await page.locator(".assistant-panel button").last().click();
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    expect(state()).toEqual({ status: "booked", version: 1 });
    await page.reload();
    await expect(card).toHaveCount(0);
    await expect(page.locator(".assistant-panel")).toContainText(reference, {
      timeout: 15_000,
    });
    await page.waitForTimeout(3_000);
    expect(state()).toEqual({ status: "booked", version: 1 });
  } finally {
    database.close();
  }
});

test("reload after SQL commit but before receipt does not replay cancellation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-034", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-COMMIT-RELOAD-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Committed Customer', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database.prepare("SELECT status, version FROM orders WHERE id = ?").get(id);
  let signalCommitted!: () => void;
  const committed = new Promise<void>((done) => {
    signalCommitted = done;
  });
  let releaseResponse!: () => void;
  const heldResponse = new Promise<void>((done) => {
    releaseResponse = done;
  });
  await page.route(`**/api/orders/${id}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    signalCommitted();
    await heldResponse;
    try {
      await route.fulfill({ response });
    } catch {
      /* navigation closed the old request */
    }
  });
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await page
      .locator(".assistant-panel textarea")
      .last()
      .fill(
        `Find order ${reference}, open its detail page, and use the visible cancel action. I will approve the review.`,
      );
    await page.locator(".assistant-panel button").last().click();
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    expect(state()).toEqual({ status: "booked", version: 1 });
    await card.getByRole("button", { name: "Approve" }).click();
    await committed;
    expect(state()).toEqual({ status: "cancelled", version: 2 });
    await page.reload();
    releaseResponse();
    await expect(page.locator(".assistant-panel")).toContainText(reference, {
      timeout: 15_000,
    });
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(state()).toEqual({ status: "cancelled", version: 2 });
    await page.screenshot({
      path: resolve(evidenceDir, "committed-reload.png"),
    });
    writeFileSync(
      resolve(evidenceDir, "committed-reload.json"),
      JSON.stringify(
        {
          reference,
          beforeReceipt: { status: "cancelled", version: 2 },
          afterReload: state(),
          visibleOutcome: "cancelled",
        },
        null,
        2,
      ),
    );
  } finally {
    releaseResponse();
    database.close();
  }
});

test("reload after dispatch but before server receipt reports an interrupted effect", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-035", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-DISPATCH-RELOAD-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Dispatched Customer', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  let signalDispatched!: () => void;
  const dispatched = new Promise<void>((done) => {
    signalDispatched = done;
  });
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>((done) => {
    releaseWrite = done;
  });
  await page.route(`**/api/orders/${id}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    signalDispatched();
    await heldWrite;
    try {
      await route.continue();
    } catch {
      /* navigation closed the old request */
    }
  });
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await page
      .locator(".assistant-panel textarea")
      .last()
      .fill(
        `Find order ${reference}, open its detail page, and use the visible cancel action. I will approve the review.`,
      );
    await page.locator(".assistant-panel button").last().click();
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    expect(state()).toEqual({ status: "booked", version: 1 });
    await card.getByRole("button", { name: "Approve" }).click();
    await dispatched;
    expect(state()).toEqual({ status: "booked", version: 1 });
    await page.reload();
    releaseWrite();
    await expect(page.locator(".assistant-panel")).toContainText(reference, {
      timeout: 15_000,
    });
    await expect(card).toHaveCount(0);
    await page.waitForTimeout(3_000);
    const outcome = state();
    const chatText = await page.locator(".assistant-panel").innerText();
    writeFileSync(
      resolve(evidenceDir, "dispatched-reload.json"),
      JSON.stringify(
        {
          reference,
          outcome,
          visibleStatus: chatText.slice(-600),
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: resolve(evidenceDir, "dispatched-reload.png"),
    });
    if (outcome.status === "booked") {
      expect(chatText).toContain("Outcome unconfirmed for an approved action");
      await page
        .getByTestId("copilot-status-notice")
        .getByRole("button", { name: "Dismiss" })
        .click();
      await expect(page.getByTestId("copilot-status-notice")).toHaveCount(0);
      expect(state()).toEqual({ status: "booked", version: 1 });
    } else expect(outcome).toEqual({ status: "cancelled", version: 2 });
  } finally {
    releaseWrite();
    database.close();
  }
});
