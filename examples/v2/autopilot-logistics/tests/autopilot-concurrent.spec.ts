import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("two same-origin tabs serialize conflicting actions before approval", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const evidenceDir = evidencePath("iteration-028", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
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
  const secondContext = firstContext;
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await first.goto("/sign-in");
    await first.getByRole("button", { name: /Avery Morgan/ }).click();
    await expect(
      first.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    // The tabs share one signed-in session; a second login would rotate it.
    await second.goto("/");
    await expect(
      second.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    const agents = ["logistics", "logistics"] as const;
    const pages = [first, second] as const;
    const currentThread = (page: typeof first) =>
      page.evaluate(() =>
        sessionStorage.getItem(
          "northstar:copilotkit:thread:northstar:admin:logistics",
        ),
      );
    const requestCancel = async (page: typeof first) => {
      await page
        .locator(".assistant-panel textarea")
        .last()
        .fill(
          `Cancel order ${reference} in the app. Discover its visible cancellation control; I will review the approval.`,
        );
      await page.locator(".assistant-panel textarea").last().press("Enter");
    };
    await requestCancel(first);
    const firstCard = first.getByTestId("copilot-approval");
    await expect(firstCard).toBeVisible({ timeout: 100_000 });
    expect(await firstCard.textContent()).toContain(reference);
    await requestCancel(second);
    // Keep the first review open while the second tab attempts the same record.
    await expect
      .poll(
        async () => {
          const threadId = await currentThread(second);
          if (!threadId) return false;
          const responseMessages = await second.request.get(
            `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
          );
          if (!responseMessages.ok()) return false;
          return (await responseMessages.json()).messages.some(
            (message: { role: string; content?: string }) =>
              message.role === "tool" &&
              message.content?.includes("Another tab or agent"),
          );
        },
        { timeout: 50_000 },
      )
      .toBe(true);
    await expect(second.getByTestId("copilot-approval")).toHaveCount(0);
    expect(state()).toEqual({ status: "booked", version: 1 });
    await firstCard.getByRole("button", { name: "Approve" }).click();
    await expect.poll(state).toEqual({ status: "cancelled", version: 2 });
    const threads: string[] = [];
    const results: string[] = [];
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const agent = agents[index];
      await expect
        .poll(
          async () => {
            const threadId = await currentThread(page);
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
              .find(
                (content) =>
                  content.includes('"status":"completed"') ||
                  content.includes("Another tab or agent"),
              );
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
    expect(results[1]).toContain("Another tab or agent");
    expect(results[1]).not.toContain('"status":"completed"');
    expect(state()).toEqual({ status: "cancelled", version: 2 });
    writeFileSync(
      resolve(evidenceDir, "concurrent.json"),
      JSON.stringify(
        {
          threads,
          agents,
          reference,
          secondTabRefusedWhileFirstReviewOpen: true,
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
    database.close();
  }
});
