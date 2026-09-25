import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("changed form handler during review denies the live agent write", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-023", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.cwd(), "data/northstar.sqlite"),
    { readOnly: true },
  );
  const customer = `Handler Swap ${Date.now()}`;
  const orderCount = () =>
    (
      database
        .prepare("SELECT count(*) AS count FROM orders WHERE customer = ?")
        .get(customer) as { count: number }
    ).count;
  await page.addInitScript(() => {
    (window as any).__reviewMutations = [] as string[];
    window.confirm = (message) => {
      if (!message.includes("Then press")) return false;
      const form = document.querySelector("form[data-autopilot-draft-id]");
      form?.setAttribute("data-autopilot-handler-version", "2");
      (window as any).__reviewMutations.push("handler changed before decision");
      return true;
    };
    document.addEventListener(
      "input",
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("form[data-autopilot-draft-id]")
        )
          (window as any).__reviewMutations.push("input");
      },
      true,
    );
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const previous = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  const previousIds = new Set<string>(
    (await previous.json()).threads.map((thread: { id: string }) => thread.id),
  );
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `Create a booked express order for ${customer} from 10 Fiction Way, Portland, OR to 20 Example Street, Seattle, WA on 2026-11-18, assigned to Jordan Lee, using the app's create form. I will review the exact values.`,
    );
  await page.locator(".assistant-panel button").last().click();
  let threadId = "";
  let messages: Array<{ role: string; content?: string }> = [];
  await expect
    .poll(
      async () => {
        const threads = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
        threadId =
          (await threads.json()).threads.find(
            (thread: { id: string }) => !previousIds.has(thread.id),
          )?.id ?? "";
        if (!threadId) return false;
        const response = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        if (!response.ok()) return false;
        messages = (await response.json()).messages;
        return messages.some(
          (message) =>
            message.role === "tool" &&
            message.content?.includes("Action binding changed"),
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(orderCount()).toBe(0);
  const mutations = await page.evaluate(
    () => (window as any).__reviewMutations as string[],
  );
  expect(mutations).toContain("handler changed before decision");
  expect(mutations).not.toContain("input");
  writeFileSync(
    resolve(evidenceDir, "handler-change.json"),
    JSON.stringify(
      { threadId, customer, orderCount: orderCount(), mutations },
      null,
      2,
    ),
  );
  database.close();
});
