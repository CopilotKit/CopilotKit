import { expect, test } from "@playwright/test";

// QA reference: qa/interrupt-headless.md
// Demo source: src/app/demos/interrupt-headless/page.tsx
//
// Headless interrupt via `useHeadlessInterrupt`. Shares the `interrupt_agent`
// backend with gen-ui-interrupt, but instead of rendering the time picker
// INLINE in the chat, it renders a popup in the LEFT app-surface pane (a
// `role="dialog"` keyed by `data-testid="interrupt-headless-popup"`). When the
// agent calls `schedule_meeting`, LangGraph's `interrupt()` surfaces the slot
// payload via the hook; picking a slot resolves the interrupt, the popup
// vanishes, the empty state returns, and the agent confirms back in chat.
//
// Ported from showcase/integrations/ms-agent-dotnet/tests/e2e/interrupt-headless.spec.ts,
// adapted to LGP's actual demo + aimock fixture (d6/langgraph-python/interrupt-headless.json):
//   - The MAF fixture supported a cancel→denied leg; LGP's fixture resolves the
//     second leg by toolCallId and always confirms "Booked: ...". So this spec
//     asserts the PICK flow (the QA-documented happy path), not cancel.
//   - Uses a TYPED prompt (not a suggestion pill); pill-click was observed not
//     to reliably drive schedule_meeting on the shared interrupt_agent.

test.describe("Interrupt Headless", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Wait for the CopilotKit runtime POST to complete before interacting,
    // otherwise messages sent against the provisional agent stub are dropped.
    const runtimeReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/copilotkit") &&
        res.request().method() === "POST" &&
        res.status() === 200,
    );
    await page.goto("/demos/interrupt-headless");
    await runtimeReady;
  });

  test("page loads with the empty app surface and no popup", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.getByTestId("interrupt-headless-empty"),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="interrupt-headless-popup"]'),
    ).toHaveCount(0);
  });

  test("picking a time slot resolves the interrupt and the agent confirms the booking", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use schedule_meeting to book an intro call with the sales team to discuss pricing.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // The interrupt popup renders in the left app-surface pane.
    const popup = page.locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60_000 });
    await expect(
      popup.getByRole("heading", { name: "Sales intro call" }),
    ).toBeVisible();

    // Slot buttons come from the fixture payload (Mon 10:00 AM / Tue 2:00 PM).
    const slot = popup.locator('[data-testid^="interrupt-headless-slot-"]');
    await expect(slot.first()).toBeVisible();
    await slot.first().click();

    // Picking resolves the interrupt: popup vanishes, empty state returns.
    await expect(popup).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("interrupt-headless-empty")).toBeVisible({
      timeout: 10_000,
    });

    // The agent confirms the booking back in the chat transcript.
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: /Booked.*Sales intro call/i })
        .first(),
    ).toBeVisible({ timeout: 45_000 });
  });
});
