import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/frontend-tools-async/{page.tsx, notes-card.tsx}
//
// The demo registers ONE async frontend tool via `useFrontendTool`:
// `query_notes(keyword: string)`. The handler sleeps 500ms (simulated local
// DB latency), then returns up to 5 matches from an in-memory 7-note DB.
// A custom `render` mounts `NotesCard`, which exposes:
//   - `data-testid="notes-card"`: the outer container
//   - `data-testid="notes-keyword"`: the heading, `Matching "<keyword>"`
//   - `data-testid="notes-list"`: the <ul> of matches
//   - `data-testid="note-n1"` to `note-n7`: one row per note
//
// The aimock fixtures answer each pill's prompt with a `query_notes(keyword)`
// call, so the async handler runs against the real client-side NOTES_DB. The
// card's heading shows the fixture's keyword, and the rows are what the
// handler returned. Together they prove the async tool round trip.

const PILL_TIMEOUT = 15_000;
const CARD_TIMEOUT = 60_000;
const CONTENT_TIMEOUT = 30_000;

const PROJECT_PLANNING_PILL = /Find project-planning notes/i;
const AUTH_PILL = /Search for 'auth'/i;
const READING_PILL = /What do I have about reading\?/i;

async function clickPill(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).click();
}

function notesCards(page: Page) {
  return page.locator('[data-testid="notes-card"]');
}

// Waits for the first Notes DB card and checks the keyword in its heading.
async function expectFirstNotesCard(page: Page, keyword: RegExp) {
  const card = notesCards(page).first();
  await expect(card).toBeVisible({ timeout: CARD_TIMEOUT });
  await expect(card.locator('[data-testid="notes-keyword"]')).toHaveText(
    keyword,
    { timeout: CONTENT_TIMEOUT },
  );
  await expect(card.locator('[data-testid="notes-list"]')).toBeVisible({
    timeout: CONTENT_TIMEOUT,
  });
  return card;
}

describeDemo(
  "frontend-tools-async",
  "Frontend Tools (async query_notes)",
  () => {
    test.setTimeout(120_000);

    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("frontend-tools-async"));
    });

    test("page loads with composer and 3 pills", async ({ page }) => {
      await expect(page.getByPlaceholder("Type a message")).toBeVisible();
      for (const name of [PROJECT_PLANNING_PILL, AUTH_PILL, READING_PILL]) {
        await expect(page.getByRole("button", { name })).toBeVisible({
          timeout: PILL_TIMEOUT,
        });
      }
    });

    test("project-planning pill renders a Notes DB card with project-planning notes", async ({
      page,
    }) => {
      await clickPill(page, PROJECT_PLANNING_PILL);

      const card = await expectFirstNotesCard(
        page,
        /Matching\s+["“]project planning["”]/i,
      );

      // The handler matches n1 ("Q2 project planning kickoff") and n5
      // ("Project planning retrospective notes").
      await expect(card.locator('[data-testid="note-n1"]')).toBeVisible();
      await expect(card.locator('[data-testid="note-n5"]')).toBeVisible();

      // The generic-plan answer of the cross-demo catch-all fixture must not
      // appear. If it does, the demo's fixture lost match priority.
      await expect(
        page.getByText("Research the topic, Outline key points"),
      ).toHaveCount(0);
    });

    test("auth pill renders a Notes DB card with auth-related notes", async ({
      page,
    }) => {
      await clickPill(page, AUTH_PILL);

      const card = await expectFirstNotesCard(page, /Matching\s+["“]auth["”]/i);

      // The handler matches n2 ("Planning: migrate auth to passkeys") on its
      // "auth" tag.
      await expect(card.locator('[data-testid="note-n2"]')).toBeVisible();

      // The showcase-assistant catch-all fixture must not answer this prompt.
      await expect(page.getByText("I'm your showcase assistant")).toHaveCount(
        0,
      );
    });

    test("reading pill renders Book recommendations and the scripted narration", async ({
      page,
    }) => {
      await clickPill(page, READING_PILL);

      const card = await expectFirstNotesCard(
        page,
        /Matching\s+["“]reading["”]/i,
      );
      await expect(card.getByText("1 match", { exact: false })).toBeVisible({
        timeout: CONTENT_TIMEOUT,
      });

      const note = card.locator('[data-testid="note-n4"]');
      await expect(note).toBeVisible({ timeout: CONTENT_TIMEOUT });
      await expect(note.getByText("Book recommendations")).toBeVisible();
      await expect(note.getByText(/Thinking Fast and Slow/i)).toBeVisible();
      await expect(
        note.getByText(/The Design of Everyday Things/i),
      ).toBeVisible();
      await expect(note.getByText("reading", { exact: true })).toBeVisible();

      // The scripted second-turn answer proves the tool result reached the
      // agent.
      await expect(
        page
          .locator('[data-testid="copilot-assistant-message"]')
          .filter({
            hasText:
              'You have a note titled "Book recommendations" that is tagged with "reading',
          })
          .first(),
      ).toBeVisible({ timeout: CARD_TIMEOUT });
    });

    // Regression for the aimock multi-pill bug: the fixtures used
    // `hasToolResult` gates to split the first turn (call `query_notes`) from
    // the follow-up (narration). After an earlier tool-using pill in the same
    // thread, the first-turn fixture was skipped and no Notes DB card
    // rendered. The fixtures now chain via `toolCallId`. This test drives all
    // three pills in one thread and expects one card per pill.
    test("sequential pills in one thread each render their own Notes DB card", async ({
      page,
    }) => {
      test.setTimeout(240_000);

      const steps = [
        {
          pill: PROJECT_PLANNING_PILL,
          keyword: /Matching\s+["“]project planning["”]/i,
        },
        { pill: AUTH_PILL, keyword: /Matching\s+["“]auth["”]/i },
        { pill: READING_PILL, keyword: /Matching\s+["“]reading["”]/i },
      ];
      for (const [index, { pill, keyword }] of steps.entries()) {
        await clickPill(page, pill);
        await expect
          .poll(() => notesCards(page).count(), { timeout: CARD_TIMEOUT })
          .toBe(index + 1);
        await expect(
          page.locator('[data-testid="notes-keyword"]', { hasText: keyword }),
        ).toBeVisible({ timeout: CARD_TIMEOUT });
      }
    });
  },
);
