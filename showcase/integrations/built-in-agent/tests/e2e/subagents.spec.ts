import { expect, Page, test } from "@playwright/test";

// Sub-Agents demo (Phase-1D, multi-agent family).
//
// Demo source: src/app/demos/subagents/page.tsx
// Backend agent: src/agents/subagents.py (supervisor + 3 sub-agents)
// Aimock fixtures: showcase/aimock/d5-all.json (3 pill chains)
//
// The supervisor delegates to research → writing → critique sub-agents.
// Each delegation renders an inline tool-card in the chat stream via
// `useRenderTool` plus an entry in the side-panel delegation log.
//
// Each test drives a verbatim suggestion-pill prompt (see
// `src/app/demos/subagents/suggestions.ts`) end-to-end through the
// fixture chain and asserts:
//   1. all three role-scoped cards render
//      (`[data-testid="subagent-card-<role>"]`),
//   2. each card's `[data-testid="subagent-result"]` is non-empty AND
//      does not echo the showcase-assistant boilerplate (catches the
//      previous bug where Writer/Critic cards leaked the chat
//      welcome text), and
//   3. exactly one critic card renders per supervisor run, with a
//      stable `done` status (catches the previous critic-loop bug).

const PILLS = {
  blog: "Write a blog post",
  explain: "Explain a topic",
  summarize: "Summarize a topic",
} as const;

const ROLES = ["researcher", "writer", "critic"] as const;
type Role = (typeof ROLES)[number];

// Showcase boilerplate strings the previous wiring leaked into Writer
// and Critic cards. Asserting these are absent guards against any
// regression where the assistant intro overwrites real sub-agent
// output.
const BOILERPLATE_FRAGMENTS = [
  "Hi there! I'm your showcase assistant",
  "Here are the things I can help with",
] as const;

async function clickPill(page: Page, title: string): Promise<void> {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
}

async function waitForAllCardsDone(page: Page): Promise<void> {
  // All three subagent cards must be visible AND in the `done` status
  // before we assert on result content (the result `<div>` only
  // mounts when the tool-render status hits `complete`).
  for (const role of ROLES) {
    const card = page.locator(`[data-testid="subagent-card-${role}"]`).first();
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card).toHaveAttribute("data-status", "complete", {
      timeout: 90_000,
    });
  }
}

async function assertCardResultGenuine(page: Page, role: Role): Promise<void> {
  const card = page.locator(`[data-testid="subagent-card-${role}"]`).first();
  const result = card.locator('[data-testid="subagent-result"]').first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  const text = (await result.textContent())?.trim() ?? "";
  expect(text.length, `${role} result should be non-empty`).toBeGreaterThan(0);
  expect(text, `${role} result should not be the empty-fallback`).not.toBe(
    "(empty)",
  );
  for (const fragment of BOILERPLATE_FRAGMENTS) {
    expect(
      text,
      `${role} result must not echo showcase boilerplate "${fragment}"`,
    ).not.toContain(fragment);
  }
}

test.describe("Sub-Agents", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/subagents");
    // Wait for the chat composer + pills to mount before any click
    // dispatches — the suggestion handler attaches asynchronously.
    await expect(
      page.getByPlaceholder("Give the supervisor a task..."),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("page loads with composer, 3 pills, and 3 subagent indicators", async ({
    page,
  }) => {
    // Composer textarea visible.
    await expect(
      page.getByPlaceholder("Give the supervisor a task..."),
    ).toBeVisible();

    // 3 verbatim suggestion pills render.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of Object.values(PILLS)) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // 3 always-visible subagent role indicators in the side panel.
    for (const role of ROLES) {
      await expect(
        page.locator(`[data-testid="subagent-indicator-${role}"]`),
      ).toBeVisible();
    }
  });

  test("Write a blog post pill produces 3 subagent cards with non-boilerplate results", async ({
    page,
  }) => {
    await clickPill(page, PILLS.blog);
    await waitForAllCardsDone(page);
    for (const role of ROLES) {
      await assertCardResultGenuine(page, role);
    }
  });

  test("Explain a topic pill produces 3 subagent cards with non-boilerplate results", async ({
    page,
  }) => {
    await clickPill(page, PILLS.explain);
    await waitForAllCardsDone(page);
    for (const role of ROLES) {
      await assertCardResultGenuine(page, role);
    }
  });

  test("Summarize a topic pill produces 3 subagent cards (regression: delegations reducer)", async ({
    page,
  }) => {
    // This pill historically returned HTTP 400 with
    // INVALID_CONCURRENT_GRAPH_UPDATE on the `delegations` state key
    // because the TypedDict didn't declare a reducer. Reaching `done`
    // on all three cards confirms the `Annotated[..., operator.add]`
    // reducer in `subagents.py` is in place — without it the supervisor
    // run would error out and at least one card would never reach
    // `complete`.
    await clickPill(page, PILLS.summarize);
    await waitForAllCardsDone(page);
    for (const role of ROLES) {
      await assertCardResultGenuine(page, role);
    }
  });

  test("Critic runs exactly once per pill click and stays done (no loop)", async ({
    page,
  }) => {
    await clickPill(page, PILLS.blog);
    await waitForAllCardsDone(page);

    const criticCards = page.locator('[data-testid="subagent-card-critic"]');
    await expect(criticCards).toHaveCount(1);

    const critic = criticCards.first();
    await expect(critic).toHaveAttribute("data-status", "complete");

    // Hold for 5s and re-check: if the supervisor were to re-enter the
    // critic, a second card would render (per-call useRenderTool is
    // one-card-per-tool-call) and/or the existing card would flip
    // away from `complete`. The status must stay `complete` and the
    // count must stay at 1 across the dwell.
    await page.waitForTimeout(5_000);
    await expect(criticCards).toHaveCount(1);
    await expect(critic).toHaveAttribute("data-status", "complete");
  });
});
