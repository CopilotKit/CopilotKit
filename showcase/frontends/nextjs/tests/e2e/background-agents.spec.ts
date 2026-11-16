import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Background Agents: a Mastra background task, shown as an activity card.
//
// Demo: src/app/demos/[integration]/background-agents/
// Manual QA: showcase/integrations/mastra/qa/background-agents.md
//
// The agent's `run_deep_research` tool has `background: { enabled: true }`,
// and the Mastra instance turns on its BackgroundTaskManager. So when the
// agent calls the tool, Mastra runs it in the background and emits a
// `background-task-started` lifecycle chunk. The Mastra AG-UI adapter maps
// that chunk to an activity (type `mastra-background-task`) and shows no
// normal tool call for it. The page registers `backgroundTaskActivityRenderer`
// through `renderActivityMessages`, which draws a live "working" card
// (data-testid="background-task-activity").
//
// What these tests can check: Mastra delivers completion out of band. On the
// dispatching run's stream it sends only `started` and a placeholder result,
// so within the turn the card's status stays `running`. These tests check the
// deterministic part: the page loads, the pills render, and a "working"
// activity card appears. They do not check completion.

describeDemo(
  "background-agents",
  "Background Agents (Mastra background task → activity card)",
  () => {
    test.setTimeout(120_000);

    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("background-agents"));
    });

    test("page loads with chat input and no activity card rendered", async ({
      page,
    }) => {
      await expect(page.getByPlaceholder("Type a message")).toBeVisible();
      await expect(
        page.locator('[data-testid="background-task-activity"]'),
      ).toHaveCount(0);
    });

    test("both suggestion pills render with verbatim titles", async ({
      page,
    }) => {
      const suggestions = page.locator('[data-testid="copilot-suggestion"]');
      await expect(
        suggestions.filter({ hasText: "Research AI agent frameworks" }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        suggestions
          .filter({ hasText: "Investigate renewable energy trends" })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    test("dispatching deep research shows a 'working' activity card", async ({
      page,
    }) => {
      await page
        .getByRole("button", { name: /Research AI agent frameworks/i })
        .click();

      // The background tool shows up only as an activity card, never as a
      // normal tool call.
      const card = page.locator('[data-testid="background-task-activity"]');
      await expect(card.first()).toBeVisible({ timeout: 60_000 });

      // Completion arrives out of band, so within the turn the status is
      // `running` and the card reads "Working".
      await expect(
        page.locator('[data-testid="background-task-status"]').first(),
      ).toHaveText(/Working/i, { timeout: 60_000 });

      // The card carries the running status attribute.
      await expect(card.first()).toHaveAttribute(
        "data-status",
        /running|resumed/,
      );
    });

    test("typed research prompt also shows a working activity card", async ({
      page,
    }) => {
      const input = page.getByPlaceholder("Type a message");
      await input.fill(
        "Kick off deep research on emerging renewable energy trends for 2026.",
      );
      await input.press("Enter");

      await expect(
        page.locator('[data-testid="background-task-activity"]').first(),
      ).toBeVisible({ timeout: 60_000 });
    });
  },
);
