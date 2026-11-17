import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Shared State (Read + Write): the Preferences + Scratch Pad demo. The page
// publishes `agent.state.preferences` with setState, and the agent writes
// back with its `set_notes` tool. Each pill and prompt below has its own
// shared-state fixture in aimock, so none of them falls through to the bare
// "hi" / "plan" catch-alls.
describeDemo("shared-state-read-write", "Shared State (Read + Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("shared-state-read-write"));
  });

  test("preferences panel and agent scratch pad both mount", async ({
    page,
  }) => {
    await expect(page.getByText("Your preferences")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Agent Scratch pad")).toBeVisible({
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

  // The Greet me pill ("Say hi and introduce yourself.") must reach the
  // shared-state fixture, not the bare `userMessage: "hi"` fixture, which
  // answers with the generic showcase-assistant blurb.
  test("Greet me pill returns a shared-state-aware greeting, not the generic showcase blurb", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: /^Greet me$/i }).click();

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(assistantMessage).toContainText(/shared-state co-pilot/i, {
      timeout: 60_000,
    });
    await expect(assistantMessage).not.toContainText(
      /showcase assistant\. I can help with weather, charts/i,
    );
  });

  // The Plan a weekend pill ("Suggest a weekend plan based on my
  // interests.") must reach the shared-state fixture, not the bare
  // `userMessage: "plan"` fixture, which answers with a generic
  // content-marketing plan.
  test("Plan a weekend pill returns an interests-aware plan, not the generic content-marketing plan", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.getByRole("button", { name: /^Plan a weekend$/i }).click();

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(assistantMessage).toContainText(/interests panel/i, {
      timeout: 60_000,
    });
    await expect(assistantMessage).not.toContainText(
      /Research the topic[\s\S]*Outline key points/i,
    );
  });

  // UI -> agent: the preferences card renders `agent.state.preferences`, so
  // a typed name shows in the state preview only after `agent.setState`
  // has stored it.
  test("an edited preference is written into agent state", async ({ page }) => {
    await page.getByTestId("pref-name").fill("Ada");

    await expect(page.getByTestId("pref-state-json")).toContainText(
      '"name": "Ada"',
    );
  });

  // Agent -> UI, then UI -> agent on the same field: the agent's `set_notes`
  // tool writes a note into shared state, the notes card renders it, and
  // Clear writes an empty list back.
  test("the agent writes a note into shared state, and Clear removes it", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const input = page.getByPlaceholder("Chat with the agent...");
    await input.fill("remember that my favorite color is blue");
    await input.press("Enter");

    await expect(page.getByTestId("note-item")).toHaveText(
      [/Favorite color: blue/],
      { timeout: 60_000 },
    );

    await page.getByTestId("notes-clear-button").click();
    await expect(page.getByTestId("notes-empty")).toBeVisible();
    await expect(page.getByTestId("note-item")).toHaveCount(0);
  });
});
