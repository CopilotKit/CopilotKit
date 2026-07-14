import { test, expect } from "@playwright/test";

// Behavioral e2e for the shared-state-read-write demo (OpenClaw), run against
// aimock (deterministic LLM). The gateway injects X-AIMock-Context: openclaw,
// so these prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// This is the Preferences + Agent Scratch Pad "read + write shared state" demo.
// The bidirectional state has two slices:
//   - `preferences` is WRITTEN by the UI via agent.setState() (the Preferences
//     card is a controlled form) and READ by the agent on every turn.
//   - `notes` is WRITTEN by the agent via its `set_notes` tool and READ by the
//     UI (the Agent Scratch Pad re-renders from shared state).
//
// OpenClaw has no backend graph, so `set_notes` is FRONTEND-forwarded: the page
// declares it via `properties.stateWriterTools`, which the ag-ui adapter
// injects into the model's tool list, applies on call, and emits a
// STATE_SNAPSHOT that `useAgent({ OnStateChanged })` renders into the scratch
// pad. Because ag-ui FLATTENS the AG-UI conversation into one user prompt,
// a tool result arrives as the text "Tool set_notes returned: ..." rather than
// a role:tool message — so aimock's hasToolResult discriminator never fires on
// the follow-up. The shared "returned:" TERMINATOR fixture (kept first in
// chat.json) closes the set_notes loop with a plain text confirmation.
//
// The CopilotSidebar (input placeholder "Chat with the agent...") drives the
// conversation. Fixture responses reference the demo's own concepts
// (shared-state co-pilot / the interests panel / the two remembered notes) so
// the fixture demonstrably drives the rendered run rather than a catch-all.
test.describe("Shared State (Read + Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("preferences panel and agent scratch pad both mount", async ({
    page,
  }) => {
    await expect(page.locator('[data-testid="preferences-card"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('[data-testid="notes-card"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Your preferences")).toBeVisible();
    await expect(page.getByText("Agent Scratch pad")).toBeVisible();
    // The scratch pad starts empty (no agent-authored notes yet).
    await expect(page.locator('[data-testid="notes-empty"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test("starter suggestions render", async ({ page }) => {
    for (const title of ["Greet me", "Remember something", "Plan a weekend"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("editing preferences writes into shared state (the state JSON echoes it)", async ({
    page,
  }) => {
    const nameInput = page.locator('[data-testid="pref-name"]');
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill("Atai");

    // The shared-state JSON preview reflects agent.setState() writes.
    await expect(page.locator('[data-testid="pref-state-json"]')).toContainText(
      '"name": "Atai"',
      { timeout: 15000 },
    );
  });

  test("Greet me pill returns a shared-state-aware greeting", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: /^Greet me$/i }).click();

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(assistantMessage).toBeVisible({ timeout: 60_000 });
    // Fixture-specific: the co-pilot introduces the shared-state loop.
    await expect(assistantMessage).toContainText(/shared-state co-pilot/i, {
      timeout: 60_000,
    });
  });

  test("Plan a weekend pill returns an interests-aware plan", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: /^Plan a weekend$/i }).click();

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(assistantMessage).toBeVisible({ timeout: 60_000 });
    // Fixture-specific: references the Preferences card's interests panel.
    await expect(assistantMessage).toContainText(/interests panel/i, {
      timeout: 60_000,
    });
  });

  test("Remember something pill drives set_notes and renders notes into the scratch pad", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Scratch pad starts empty.
    await expect(page.locator('[data-testid="notes-empty"]')).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: /^Remember something$/i }).click();

    // The set_notes tool-call fixture writes two notes into shared state; the
    // ag-ui STATE_SNAPSHOT re-renders the scratch pad. This observable
    // state mutation is the load-bearing assertion for the WRITE direction.
    const noteItems = page.locator('[data-testid="note-item"]');
    await expect(noteItems).toHaveCount(2, { timeout: 60_000 });
    await expect(page.locator('[data-testid="notes-list"]')).toContainText(
      /morning meetings/i,
    );
    await expect(page.locator('[data-testid="notes-list"]')).toContainText(
      /dairy/i,
    );

    // The "returned:" terminator then closes the tool loop with a confirmation.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').last(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("clearing the scratch pad writes the empty list back into shared state", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: /^Remember something$/i }).click();

    await expect(page.locator('[data-testid="note-item"]')).toHaveCount(2, {
      timeout: 60_000,
    });

    // The Clear button is a UI-side write-back (agent.setState notes: []).
    await page.locator('[data-testid="notes-clear-button"]').click();
    await expect(page.locator('[data-testid="notes-empty"]')).toBeVisible({
      timeout: 15000,
    });
  });
});
