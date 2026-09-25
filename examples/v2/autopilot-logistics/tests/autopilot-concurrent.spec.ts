import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("two agents in separate tabs cannot reuse a stale order approval", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const evidenceDir = evidencePath("iteration-028", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const reference = `NS-RACE-${Date.now()}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Concurrent Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
    )
    .run(id, reference, now, now);
  const state = () =>
    database
      .prepare("SELECT status, version FROM orders WHERE id = ?")
      .get(id) as { status: string; version: number };
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    for (const page of [first, second]) {
      await page.goto("/sign-in");
      await page.getByRole("button", { name: /Avery Morgan/ }).click();
      await expect(
        page.getByRole("heading", { name: "Dashboard" }),
      ).toBeVisible();
    }
    await second
      .getByRole("combobox", { name: "Autopilot scope" })
      .selectOption("all");
    await second
      .getByRole("combobox", { name: "Assistant agent" })
      .selectOption("operations");
    const agents = ["logistics", "operations"] as const;
    const pages = [first, second] as const;
    const prior = await Promise.all(
      pages.map(async (page, index) => {
        const response = await page.request.get(
          `/api/copilotkit/threads?agentId=${agents[index]}`,
        );
        expect(response.ok()).toBeTruthy();
        return new Set<string>(
          (await response.json()).threads.map(
            (thread: { id: string }) => thread.id,
          ),
        );
      }),
    );
    await Promise.all(
      pages.map(async (page) => {
        await page
          .locator(".assistant-panel textarea")
          .last()
          .fill(
            `Cancel order ${reference} in the app. Find its detail page and use the visible cancellation control; I will review the approval.`,
          );
        await page.locator(".assistant-panel button").last().click();
      }),
    );
    const cards = pages.map((page) => page.getByTestId("copilot-approval"));
    await Promise.all(
      cards.map((card) => expect(card).toBeVisible({ timeout: 100_000 })),
    );
    expect(await cards[0].textContent()).toContain(reference);
    expect(await cards[1].textContent()).toContain(reference);
    expect(state()).toEqual({ status: "booked", version: 1 });
    await cards[0].getByRole("button", { name: "Approve" }).click();
    await expect
      .poll(() => state())
      .toEqual({ status: "cancelled", version: 2 });
    await cards[1].getByRole("button", { name: "Approve" }).click();
    const threads: string[] = [];
    const results: string[] = [];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const agent = agents[index];
      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `/api/copilotkit/threads?agentId=${agent}`,
            );
            const threadId =
              (await response.json()).threads.find(
                (thread: { id: string }) => !prior[index].has(thread.id),
              )?.id ?? "";
            if (!threadId) return false;
            threads[index] = threadId;
            const messagesResponse = await page.request.get(
              `/api/copilotkit/threads/${threadId}/messages?agentId=${agent}`,
            );
            if (!messagesResponse.ok()) return false;
            const messages = (await messagesResponse.json()).messages as Array<{
              role: string;
              content?: string;
              toolCalls?: Array<{ name: string }>;
            }>;
            const activation = messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content ?? "")
              .find((content) => content.includes('"operationId"'));
            if (!activation) return false;
            expect(
              messages
                .flatMap((message) => message.toolCalls ?? [])
                .map((call) => call.name),
            ).toContain("autopilot_activateControl");
            results[index] = activation;
            return true;
          },
          { timeout: 90_000 },
        )
        .toBe(true);
    }
    expect(results[0]).toContain('"status":"completed"');
    expect(results[1]).not.toContain('"status":"completed"');
    expect(state()).toEqual({ status: "cancelled", version: 2 });
    writeFileSync(
      resolve(evidenceDir, "concurrent.json"),
      JSON.stringify(
        {
          threads,
          agents,
          reference,
          bothDialogsBeforeAnyWrite: true,
          firstResult: JSON.parse(results[0]),
          secondResult: JSON.parse(results[1]),
          finalState: state(),
        },
        null,
        2,
      ),
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
    database.close();
  }
});
