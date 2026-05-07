import { test, expect } from "@playwright/test";

// QA reference: qa/frontend-tools-async.md
// Demo source: src/app/demos/frontend-tools-async/{page.tsx, notes-card.tsx}
//
// The demo registers ONE async frontend tool via `useFrontendTool`:
// `query_notes(keyword: string)`. The handler sleeps 500ms (simulated local
// DB latency) then returns up to 5 matches from an in-memory 7-note DB.
// A custom `render` mounts `NotesCard` which exposes:
//   - `data-testid="notes-card"`     (outer container)
//   - `data-testid="notes-keyword"`  (heading: `Matching "<keyword>"`)
//   - `data-testid="notes-list"`     (the <ul> of matches)
//   - `data-testid="note-n1"` … `note-n7` per-note rows
//
// Genuine-pass strategy: the deterministic aimock fixtures match each pill's
// verbatim prompt with a dedicated `query_notes(keyword=…)` tool call so the
// async handler runs against the real client-side NOTES_DB. The card's
// `keyword` heading is then the keyword we asserted in the fixture, and the
// `notes-list` rows reflect the actual handler-filtered results — proving
// the async tool round-trip end-to-end.

test.describe("Frontend Tools (async query_notes)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with composer and 3 pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Find project-planning notes/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /Search for 'auth'/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /What do I have about reading\?/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("project-planning pill → Notes DB card with project-planning notes", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /Find project-planning notes/i })
      .click();

    const notesCard = page.locator('[data-testid="notes-card"]').first();
    await expect(notesCard).toBeVisible({ timeout: 60_000 });

    // The keyword heading proves the async handler resolved against the
    // fixture-emitted `query_notes(keyword="project planning")` call.
    await expect(notesCard.locator('[data-testid="notes-keyword"]')).toHaveText(
      /Matching\s+"project planning"/i,
      { timeout: 30_000 },
    );

    // The async handler matches notes n1 ("Q2 project planning kickoff")
    // and n5 ("Project planning retrospective notes") from NOTES_DB.
    const list = notesCard.locator('[data-testid="notes-list"]');
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(notesCard.locator('[data-testid="note-n1"]')).toBeVisible();
    await expect(notesCard.locator('[data-testid="note-n5"]')).toBeVisible();

    // Anti-regression: the generic-plan boilerplate from the cross-cell
    // catch-all fixture must NOT appear. If it does, the d5-all.json
    // fixture lost match priority to feature-parity.json's "plan" entry.
    await expect(
      page.getByText("Research the topic, Outline key points"),
    ).toHaveCount(0);
  });

  test("auth pill → Notes DB card with auth-related notes", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Search for 'auth'/i }).click();

    const notesCard = page.locator('[data-testid="notes-card"]').first();
    await expect(notesCard).toBeVisible({ timeout: 60_000 });

    await expect(notesCard.locator('[data-testid="notes-keyword"]')).toHaveText(
      /Matching\s+"auth"/i,
      { timeout: 30_000 },
    );

    // The async handler matches note n2 ("Planning: migrate auth to
    // passkeys") on the "auth" tag.
    const list = notesCard.locator('[data-testid="notes-list"]');
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(notesCard.locator('[data-testid="note-n2"]')).toBeVisible();

    // Anti-regression: the showcase-assistant catch-all from
    // feature-parity.json must NOT have intercepted this prompt.
    await expect(page.getByText("I'm your showcase assistant")).toHaveCount(0);
  });

  test("reading pill → Notes DB card with Book recommendations + locked narration", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /What do I have about reading\?/i })
      .click();

    const notesCard = page.locator('[data-testid="notes-card"]').first();
    await expect(notesCard).toBeVisible({ timeout: 60_000 });

    // Keyword heading + match count + per-note testid + content +
    // tag chip — the full canonical shape per spec test #4.
    await expect(notesCard.locator('[data-testid="notes-keyword"]')).toHaveText(
      /Matching\s+"reading"/i,
      { timeout: 30_000 },
    );
    await expect(notesCard.getByText("1 match", { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    const note = notesCard.locator('[data-testid="note-n4"]');
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note.getByText("Book recommendations")).toBeVisible();
    await expect(note.getByText(/Thinking Fast and Slow/i)).toBeVisible();
    await expect(
      note.getByText(/The Design of Everyday Things/i),
    ).toBeVisible();
    await expect(note.getByText("reading", { exact: true })).toBeVisible();

    // Locked narration leading phrase — proves the deterministic 2nd-turn
    // fixture wired correctly through the async tool result.
    await expect(
      page
        .locator('[data-role="assistant"]')
        .filter({
          hasText:
            'You have a note titled "Book recommendations" that is tagged with "reading',
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
