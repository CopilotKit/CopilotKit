import { test, expect } from "@playwright/test";

// Shared State (Read + Write) — Preferences + Scratch Pad demo. The page
// publishes `agent.state.preferences` via setState, and the agent writes
// back via its `set_notes` tool. All three pills must hit
// shared-state-specific fixtures rather than falling through to the bare
// "hi" / "plan" catch-alls in feature-parity.json.
test.describe("Shared State (Read + Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
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

  // Regression for the wrong-fixture-fallthrough bug:
  // The Greet me pill ("Say hi and introduce yourself.") was matching
  // feature-parity.json's bare `userMessage: "hi"` fixture and replying
  // with the generic showcase-assistant blurb ("Hi there! I'm your
  // showcase assistant. I can help with weather, charts, meetings…").
  // Likewise, Plan a weekend ("Suggest a weekend plan based on my
  // interests.") was matching the bare `userMessage: "plan"` fixture and
  // replying with a generic 5-step content-marketing plan. Fix: add
  // d5-all.json fixtures with longer substring matchers that win first.
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
    // Negative assertion: the wrong-fixture response is gone.
    await expect(assistantMessage).not.toContainText(
      /showcase assistant\. I can help with weather, charts/i,
    );
  });

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
    // Negative assertion: the wrong-fixture response is gone.
    await expect(assistantMessage).not.toContainText(
      /Research the topic.*Outline key points/is,
    );
  });
});
