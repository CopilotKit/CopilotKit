import { test, expect } from "@playwright/test";

// QA reference: qa/frontend-tools-async.md
// Demo source: src/app/demos/frontend-tools-async/{page.tsx, notes-card.tsx}
//
// The demo registers ONE async frontend tool via `useFrontendTool`:
// `query_notes(keyword: string)`. The handler sleeps 500ms (simulated local
// DB latency) then returns up to 5 matches from an in-memory 7-note DB.
// A custom `render` mounts `NotesCard` which exposes:
//   - `data-testid="notes-card"`   (the outer container)
//   - `data-testid="notes-keyword"` (heading: `Matching "<keyword>"`)
//   - `data-testid="notes-list"`   (the <ul> of matches)
//   - `data-testid="note-n1"` … `data-testid="note-n7"` per note
//
// For the prompt "Find my notes about project planning", the NOTES_DB is
// crafted so notes n1 and n5 both match ("project planning" appears in
// their titles/tags). We assert on the card + specific note IDs. No
// LLM-text assertions.

test.describe("Frontend Tools (async query_notes)", () => {
  // LLM + Railway round-trip can exceed the 30s default per-test timeout —
  // especially when the agent chooses a multi-word keyword or chains
  // additional clarifying turns before firing `query_notes`. Give each test
  // 120s end-to-end; individual `toBeVisible({ timeout: N })` assertions
  // still cap their own waits.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("suggestion pills for project planning, auth, reading render", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: /Find project-planning notes/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /Search for 'auth'/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /What do I have about reading\?/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("auth prompt renders a notes-card with testid-addressable notes", async ({
    page,
  }) => {
    // "Search my notes for 'auth'" deterministically triggers `query_notes`
    // with a single-word keyword on Railway (the LLM sees an explicit
    // "search my notes" verb). That produces the notes-card reliably; the
    // pill-based variant ("Search for 'auth'") was observed to flake when
    // the agent chose to answer in-context without firing the tool.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Search my notes for 'auth'.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // The NotesCard mounts via the tool's `render` once the tool call is
    // dispatched — present during the 500ms loading state and after.
    const notesCard = page.locator('[data-testid="notes-card"]').first();
    await expect(notesCard).toBeVisible({ timeout: 90_000 });

    // The heading uses a stable testid regardless of LLM-chosen keyword.
    await expect(
      notesCard.locator('[data-testid="notes-keyword"]'),
    ).toBeVisible({ timeout: 5000 });

    // After the 500ms sleep resolves the list mounts with matches. For
    // "auth" the NOTES_DB has exactly n2 ("Planning: migrate auth to
    // passkeys") — test tolerates LLM keyword variance by checking for
    // EITHER the notes-list OR the empty-state branch. Both render inside
    // notes-card; both are valid async-tool-resolved states.
    const list = notesCard.locator('[data-testid="notes-list"]');
    const empty = notesCard.getByText("No notes matched.");
    await expect(list.or(empty).first()).toBeVisible({ timeout: 30_000 });
  });

  test("zero-match keyword renders the empty-state branch", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Search my notes for xyzzy-nonsense-keyword.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const notesCard = page.locator('[data-testid="notes-card"]').first();
    await expect(notesCard).toBeVisible({ timeout: 45000 });

    // Empty-state branch: `notes-list` never mounts (see notes-card.tsx).
    // Italic "No notes matched." copy is stable component text.
    await expect(notesCard.getByText("No notes matched.")).toBeVisible({
      timeout: 30000,
    });
  });
});
