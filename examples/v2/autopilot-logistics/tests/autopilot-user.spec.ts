import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("live admin agent updates a user through the discovered form", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const evidenceDir = evidencePath("iteration-016", String(Date.now()));
  mkdirSync(evidenceDir, { recursive: true });
  const database = new DatabaseSync(
    resolve(process.env.NORTHSTAR_DB_PATH || "data/northstar.sqlite"),
  );
  const id = crypto.randomUUID();
  const name = `Morgan Agent ${Date.now()}`;
  const state = () =>
    database
      .prepare(
        "SELECT display_name, role, active, version FROM users WHERE id = ?",
      )
      .get(id) as {
      display_name: string;
      role: string;
      active: number;
      version: number;
    };
  await page.addInitScript(() => {
    (window as any).__formSequence = [] as string[];
    document.addEventListener(
      "click",
      (event) => {
        if (
          (event.target as Element | null)?.closest(
            "[data-testid=copilot-approval] button",
          )
        )
          (window as any).__formSequence.push("decision");
      },
      true,
    );
    document.addEventListener(
      "input",
      (event) => {
        if ((event.target as Element).closest("form[data-autopilot-record-id]"))
          (window as any).__formSequence.push("input");
      },
      true,
    );
  });
  await page.goto("/sign-in");
  database
    .prepare(
      "INSERT INTO users(id, organization_id, display_name, role, active, version) VALUES (?, 'northstar', ?, 'operator', 1, 1)",
    )
    .run(id, name);
  await page.getByRole("button", { name: /Avery Morgan/ }).click();
  await page.goto("/users");
  const baseline = await page.request.get(
    "/api/copilotkit/threads?agentId=logistics",
  );
  expect(baseline.ok()).toBeTruthy();
  const prior = new Set<string>(
    (await baseline.json()).threads.map((thread: { id: string }) => thread.id),
  );
  let review = "";
  let beforeApproval: ReturnType<typeof state> | undefined;
  const approval = (async () => {
    const card = page.getByTestId("copilot-approval");
    await expect(card).toBeVisible({ timeout: 100_000 });
    review = (await card.textContent()) ?? "";
    beforeApproval = state();
    await card.getByRole("button", { name: "Approve" }).click();
  })();
  await page
    .locator(".assistant-panel textarea")
    .last()
    .fill(
      `On this Users page, change ${name}'s role from operator to viewer. Use the discovered edit form and submit it after I review the exact change. Do not change anyone else.`,
    );
  await page.locator(".assistant-panel button").last().click();
  await approval;
  let threadId = "";
  let messages: Array<{
    role: string;
    content?: string;
    toolCalls?: Array<{ name: string }>;
  }> = [];
  await expect
    .poll(
      async () => {
        const threads = await page.request.get(
          "/api/copilotkit/threads?agentId=logistics",
        );
        if (!threads.ok()) return false;
        threadId =
          (await threads.json()).threads.find(
            (thread: { id: string }) => !prior.has(thread.id),
          )?.id ?? "";
        if (!threadId) return false;
        const response = await page.request.get(
          `/api/copilotkit/threads/${threadId}/messages?agentId=logistics`,
        );
        if (!response.ok()) return false;
        messages = (await response.json()).messages;
        return (
          state().version === 2 &&
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content?.includes('"status":"completed"'),
          )
        );
      },
      { timeout: 100_000 },
    )
    .toBe(true);
  expect(beforeApproval).toEqual({
    display_name: name,
    role: "operator",
    active: 1,
    version: 1,
  });
  expect(review).toContain(`Edit user ${name}`);
  expect(review).toContain("operator → viewer");
  expect(state()).toEqual({
    display_name: name,
    role: "viewer",
    active: 1,
    version: 2,
  });
  await expect(
    page.getByRole("form", { name: `Edit user ${name}` }).getByLabel("Role"),
  ).toHaveValue("viewer");
  const sequence = await page.evaluate(
    () => (window as any).__formSequence as string[],
  );
  expect(sequence[0]).toBe("decision");
  expect(sequence).toContain("input");
  const calls = messages
    .flatMap((message) => message.toolCalls ?? [])
    .map((call) => call.name);
  expect(calls).toContain("autopilot_submitForm");
  await page.screenshot({
    path: resolve(evidenceDir, "updated-user.png"),
    fullPage: true,
  });
  writeFileSync(
    resolve(evidenceDir, "user-update.json"),
    JSON.stringify(
      {
        threadId,
        name,
        review,
        beforeApproval,
        finalState: state(),
        sequence,
        toolSequence: calls,
      },
      null,
      2,
    ),
  );
});
