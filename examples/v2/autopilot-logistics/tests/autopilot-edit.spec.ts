import { evidencePath } from "./evidence";
import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

for (const scenario of [
  {
    name: "destination",
    request: "change its destination to 30 Revised Avenue, Seattle, WA",
    expected: {
      destination: "30 Revised Avenue, Seattle, WA",
      status: "booked",
      serviceLevel: "standard",
    },
  },
  {
    name: "status",
    request: "change its status to In transit",
    expected: {
      destination: "2 Example Road, Seattle, WA",
      status: "in_transit",
      serviceLevel: "standard",
    },
  },
  {
    name: "service level custom select",
    request: "change its service level to Priority",
    expected: {
      destination: "2 Example Road, Seattle, WA",
      status: "booked",
      serviceLevel: "priority",
    },
  },
] as const) {
  test(`live agent edits order ${scenario.name} through discovered form controls`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const evidenceDir = evidencePath(
      "iteration-013",
      `${scenario.name}-${Date.now()}`,
    );
    mkdirSync(evidenceDir, { recursive: true });
    const database = new DatabaseSync(
      resolve(process.cwd(), "data/northstar.sqlite"),
    );
    const id = crypto.randomUUID();
    const reference = `NS-EDIT-${Date.now()}`;
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO orders(id, organization_id, reference, customer, origin, destination, ship_date, service_level, assigned_user_id, status, notes, private_note, version, created_at, updated_at) VALUES (?, 'northstar', ?, 'Edit Demo Client', '1 Sample Way, Portland, OR', '2 Example Road, Seattle, WA', '2026-11-18', 'standard', 'operator', 'booked', '', '', 1, ?, ?)`,
      )
      .run(id, reference, now, now);
    const state = () =>
      database
        .prepare(
          "SELECT destination, status, service_level AS serviceLevel, version FROM orders WHERE id = ?",
        )
        .get(id) as {
        destination: string;
        status: string;
        serviceLevel: string;
        version: number;
      };
    await page.addInitScript(() => {
      const originalConfirm = window.confirm.bind(window);
      (window as any).__autopilotSequence = [] as Array<{
        kind: string;
        name?: string;
        accepted?: boolean;
      }>;
      window.confirm = (message) => {
        const accepted = originalConfirm(message);
        (window as any).__autopilotSequence.push({
          kind: "decision",
          accepted,
        });
        return accepted;
      };
      document.addEventListener(
        "input",
        (event) => {
          const target = event.target;
          if (
            target instanceof HTMLElement &&
            target.closest("form[data-autopilot-record-id]")
          ) {
            (window as any).__autopilotSequence.push({
              kind: "input",
              name: target.getAttribute("name") ?? "",
            });
          }
        },
        true,
      );
    });
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Avery Morgan/ }).click();
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    const baseline = await page.request.get(
      "/api/copilotkit/threads?agentId=logistics",
    );
    expect(baseline.ok()).toBeTruthy();
    const prior = new Set<string>(
      (await baseline.json()).threads.map(
        (thread: { id: string }) => thread.id,
      ),
    );
    let review = "";
    let beforeApproval:
      | {
          destination: string;
          status: string;
          serviceLevel: string;
          version: number;
        }
      | undefined;
    page.once("dialog", async (dialog) => {
      review = dialog.message();
      beforeApproval = state();
      await dialog.accept();
    });
    await page
      .locator(".assistant-panel textarea")
      .last()
      .fill(
        `For order ${reference} (Edit Demo Client), ${scenario.request}. Leave its other shipment details unchanged. Use the app's edit form and submit after I review the exact changes.`,
      );
    await page.locator(".assistant-panel button").last().click();
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
            messages.some(
              (message) =>
                message.role === "tool" &&
                message.content?.includes('"status":"completed"'),
            ) && state().version === 2
          );
        },
        { timeout: 100_000 },
      )
      .toBe(true);
    expect(beforeApproval).toEqual({
      destination: "2 Example Road, Seattle, WA",
      status: "booked",
      serviceLevel: "standard",
      version: 1,
    });
    expect(review).toContain(reference);
    expect(state()).toEqual({ ...scenario.expected, version: 2 });
    await expect(page.getByText("Version 2")).toBeVisible();
    await expect(
      page
        .getByRole("form", { name: `Edit order ${reference}` })
        .getByRole("textbox", { name: "Destination" }),
    ).toHaveValue(scenario.expected.destination);
    await expect(
      page
        .getByRole("form", { name: `Edit order ${reference}` })
        .getByLabel("Status"),
    ).toHaveValue(scenario.expected.status);
    await expect(
      page
        .getByRole("form", { name: `Edit order ${reference}` })
        .getByRole("group", { name: "Service level" })
        .locator('button[aria-pressed="true"]'),
    ).toHaveText(
      scenario.expected.serviceLevel[0].toUpperCase() +
        scenario.expected.serviceLevel.slice(1),
    );
    const sequence = await page.evaluate(
      () =>
        (window as any).__autopilotSequence as Array<{
          kind: string;
          name?: string;
          accepted?: boolean;
        }>,
    );
    expect(sequence[0]).toEqual({ kind: "decision", accepted: true });
    expect(sequence.some((event) => event.kind === "input")).toBe(true);
    const calls = messages
      .flatMap((message) => message.toolCalls ?? [])
      .map((call) => call.name);
    expect(calls).toContain("autopilot_submitForm");
    await page.screenshot({
      path: resolve(evidenceDir, "edited-order.png"),
      fullPage: true,
    });
    writeFileSync(
      resolve(evidenceDir, "edit.json"),
      JSON.stringify(
        {
          threadId,
          reference,
          scenario: scenario.name,
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
}
