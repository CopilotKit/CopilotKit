import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidencePath } from "./evidence";

test("Stop after human approval does not conceal a committed cancellation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-029", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-ACCEPTED-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Accepted Customer', 'Portland', 'Seattle', '2026-11-18', 'express', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database.prepare("SELECT status, version FROM orders WHERE id = ?").get(id);
  let signalDispatched!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    signalDispatched = resolve;
  });
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route(`**/api/orders/${id}`, async (route) => {
    if (route.request().method() === "POST") {
      signalDispatched();
      await heldWrite;
    }
    await route.continue();
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
    const stoppedAt = Date.now();
    await page.getByTestId("copilot-send-button").click();
    expect(Date.now() - stoppedAt).toBeLessThan(5_000);
    releaseWrite();
    await expect
      .poll(state, { timeout: 10_000 })
      .toEqual({ status: "cancelled", version: 2 });
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      path: resolve(evidenceDir, "accepted-stop-outcome.png"),
    });
    writeFileSync(
      resolve(evidenceDir, "accepted-stop.json"),
      JSON.stringify(
        {
          reference,
          beforeRelease: { status: "booked", version: 1 },
          afterRelease: state(),
          visibleOutcome: "cancelled",
          stopWasAvailableWhileWriteHeld: true,
        },
        null,
        2,
      ),
    );
  } finally {
    releaseWrite();
    database.close();
  }
});
