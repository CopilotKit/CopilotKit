import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

for (const takeover of ["edit", "navigate", "sign out", "Stop"] as const) {
  test(`human ${takeover} cancels a pending CopilotKit approval`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const database = new DatabaseSync(
      resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
    );
    const id = crypto.randomUUID();
    const reference = `NS-TAKE-${Date.now()}`;
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Takeover Customer', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
      )
      .run(id, reference, now, now);
    const state = () =>
      database
        .prepare("SELECT status, version FROM orders WHERE id = ?")
        .get(id);
    try {
      await page.goto("/sign-in");
      await page.getByRole("button", { name: /Avery Morgan/ }).click();
      await page
        .locator(".assistant-panel textarea")
        .last()
        .fill(
          `Find order ${reference}, open its detail page, and use its visible cancel control. I will review the approval.`,
        );
      await page.locator(".assistant-panel button").last().click();
      const card = page.getByTestId("copilot-approval");
      await expect(card).toBeVisible({ timeout: 100_000 });
      expect(await card.textContent()).toContain(reference);
      expect(state()).toEqual({ status: "booked", version: 1 });
      const takeoverStarted = Date.now();

      if (takeover === "edit") {
        await page
          .locator('form[data-autopilot-record-id] [name="destination"]')
          .fill("Tacoma");
      } else if (takeover === "navigate") {
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Orders" })
          .click();
      } else if (takeover === "sign out") {
        await page.getByRole("button", { name: "Sign out" }).click();
      } else {
        await page.getByTestId("copilot-send-button").click();
      }

      await expect(card).toBeHidden({ timeout: 10_000 });
      expect(Date.now() - takeoverStarted).toBeLessThan(5_000);
      await expect
        .poll(state, { timeout: 10_000 })
        .toEqual({ status: "booked", version: 1 });
    } finally {
      database.close();
    }
  });
}

test("a manual cancel takes over a pending agent approval", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-MANUAL-TAKE-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Manual Takeover', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database.prepare("SELECT status, version FROM orders WHERE id = ?").get(id);
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    expect(dialog.message()).toContain(reference);
    await dialog.accept();
  });
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await page
      .locator(".assistant-panel textarea")
      .last()
      .fill(
        `Find order ${reference}, open its detail page, and use its visible cancel control. I will review the approval.`,
      );
    await page.locator(".assistant-panel button").last().click();
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    expect(state()).toEqual({ status: "booked", version: 1 });
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(card).toBeHidden({ timeout: 5_000 });
    await expect.poll(() => dialogs).toBe(1);
    await expect.poll(state).toEqual({ status: "cancelled", version: 2 });
  } finally {
    database.close();
  }
});
