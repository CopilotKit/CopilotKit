import { test, expect } from "@playwright/test";

// QA reference: qa/readonly-state-agent-context.md
// Demo source: src/app/demos/readonly-state-agent-context/page.tsx
//
// The demo publishes three frontend-only values to the agent via
// `useAgentContext`: `userName` (default "Atai"), `userTimezone`
// (default "America/Los_Angeles"), and `recentActivity` (defaults to
// ACTIVITIES[0] "Viewed the pricing page" + ACTIVITIES[2] "Watched the
// product demo video"). Suggestion pills render verbatim message bodies:
//   - "Who am I?"          → "What do you know about me from my context?"
//   - "Suggest next steps" → "Based on my recent activity, what should I try next?"
//   - "Plan my morning"    → "What time is it in my timezone and what should I do for the next hour?"
//
// All three prompts are pinned to deterministic aimock fixtures (see
// showcase/aimock/d5-all.json). Each fixture's `systemMessage` matcher
// uses the 1.21.0 array form to AND-gate on three default-state tokens:
//   - `"value": "Atai"` (name)
//   - `"value": "America/Los_Angeles"` (timezone)
//   - the full default activity-list substring
// Any deviation in any of those tokens causes the fixture to fall through
// to the upstream proxy (real LLM in prod, error in CI without a real
// key) — that's the regression bar the negative tests below enforce.

test.describe("Readonly Agent Context (useAgentContext)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("page loads: context-card + composer render", async ({ page }) => {
    await expect(page.getByTestId("context-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });

  test("editing name + timezone updates the published JSON preview", async ({
    page,
  }) => {
    const json = page.getByTestId("ctx-state-json");

    // Edit name → "Jamie".
    await page.getByTestId("ctx-name").fill("Jamie");
    await expect(json).toContainText('"name": "Jamie"');

    // Change timezone via <select>.
    await page.getByTestId("ctx-timezone").selectOption("Asia/Tokyo");
    await expect(json).toContainText('"timezone": "Asia/Tokyo"');
  });

  test('"Who am I?" pill — assistant acknowledges identity + identity card matches defaults', async ({
    page,
  }) => {
    // Identity card shows the defaults BEFORE we click the pill — these
    // assertions don't depend on the round-trip and lock the testids.
    await expect(page.getByTestId("identity-name")).toHaveText("Atai");
    await expect(page.getByTestId("identity-timezone")).toHaveText(
      "America/Los_Angeles",
    );
    await expect(page.getByTestId("identity-avatar")).toHaveText("A");

    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Who am I?" });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.first().click();

    // Aimock fixture for the verbatim pill prompt
    // ("What do you know about me from my context?") returns a content reply
    // beginning with "I see you're Atai".
    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant.filter({ hasText: "I see you're Atai" }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("activity checkboxes default-checked: pricing page + product demo video", async ({
    page,
  }) => {
    // ACTIVITIES[0] and ACTIVITIES[2] are the default-selected entries in
    // page.tsx. Their <label> testids embed the kebab-cased activity name.
    const pricingLabel = page.getByTestId("activity-viewed-the-pricing-page");
    const demoLabel = page.getByTestId(
      "activity-watched-the-product-demo-video",
    );
    await expect(pricingLabel).toBeVisible();
    await expect(demoLabel).toBeVisible();

    // Each <label> wraps a <Checkbox> whose `checked` prop reflects
    // selection. Assert the underlying input is checked.
    await expect(pricingLabel.locator('input[type="checkbox"]')).toBeChecked();
    await expect(demoLabel.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('"Suggest next steps" pill — assistant grounds reply in default activities', async ({
    page,
  }) => {
    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Suggest next steps" });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.first().click();

    // Aimock fixture for the verbatim pill prompt
    // ("Based on my recent activity, what should I try next?") returns a
    // content reply beginning with "Since you recently viewed the pricing
    // page and watched the product demo video".
    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant
        .filter({
          hasText:
            "Since you recently viewed the pricing page and watched the product demo video",
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('"Plan my morning" pill — assistant grounds reply in default name, timezone, and activities', async ({
    page,
  }) => {
    const suggestion = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Plan my morning" });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.first().click();

    // Aimock fixture for the verbatim pill prompt ("What time is it in my
    // timezone and what should I do for the next hour?") returns a content
    // reply leading with "Atai, I don't have live clock access here, but
    // your timezone is America/Los_Angeles". The fixture's three-substring
    // systemMessage gate (name + tz + activity list) only matches when all
    // three default-state tokens are present, so this assertion locks in
    // both the gate-too-strict regression (defaults don't match → real
    // LLM produces a different leading phrase) AND the response-text
    // regression (fixture content drifted away from the locked phrase).
    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant
        .filter({
          hasText:
            "Atai, I don't have live clock access here, but your timezone is America/Los_Angeles",
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("three pills clicked sequentially — each fires its own fixture without cross-talk", async ({
    page,
  }) => {
    // Regression net: rendering one pill's response must not block, race,
    // or replace another pill's response. We click all three in
    // top-to-bottom order with the chat preserving every reply, then
    // assert each fixture's locked leading phrase shows up in its own
    // assistant bubble. A bug where the fixture matcher leaks state
    // between turns (e.g. message history grows and an old assistant
    // message containing the canned text trips the `userMessage`
    // substring) would surface here as a missing or duplicated phrase.
    const suggestionFor = (label: string) =>
      page
        .locator('[data-testid="copilot-suggestion"]')
        .filter({ hasText: label })
        .first();

    const whoAmI = suggestionFor("Who am I?");
    await expect(whoAmI).toBeVisible({ timeout: 15_000 });
    await whoAmI.click();

    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant.filter({ hasText: "I see you're Atai" }).first(),
    ).toBeVisible({ timeout: 60_000 });

    // Suggestions re-render after the first turn; re-locate.
    const suggestNext = suggestionFor("Suggest next steps");
    await expect(suggestNext).toBeVisible({ timeout: 15_000 });
    await suggestNext.click();

    await expect(
      assistant
        .filter({
          hasText:
            "Since you recently viewed the pricing page and watched the product demo video",
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    const planMorning = suggestionFor("Plan my morning");
    await expect(planMorning).toBeVisible({ timeout: 15_000 });
    await planMorning.click();

    await expect(
      assistant
        .filter({
          hasText:
            "Atai, I don't have live clock access here, but your timezone is America/Los_Angeles",
        })
        .first(),
    ).toBeVisible({ timeout: 60_000 });

    // All three canned phrases must coexist in the transcript.
    await expect(
      assistant.filter({ hasText: "I see you're Atai" }),
    ).toHaveCount(1);
    await expect(
      assistant.filter({
        hasText:
          "Since you recently viewed the pricing page and watched the product demo video",
      }),
    ).toHaveCount(1);
    await expect(
      assistant.filter({
        hasText:
          "Atai, I don't have live clock access here, but your timezone is America/Los_Angeles",
      }),
    ).toHaveCount(1);
  });

  // ─── Negative tests — locking in the AND gate ──────────────────────────
  //
  // The three fixtures all require name=Atai AND tz=America/Los_Angeles AND
  // the exact default activity list in their systemMessage array. Each
  // negative test mutates ONE of those three and asserts the canned
  // leading phrase never appears within the timeout — proving the gate
  // is strict enough that a future fixture-loosening regression would
  // surface as the locked phrase showing up when it shouldn't.
  //
  // In CI without a real upstream key the proxy fall-through errors out
  // and the chat surfaces an error bubble; in local dev with a real key
  // it returns a state-aware LLM reply. Either way, the canned leading
  // phrase is what the negative assertion forbids.

  test('"Who am I?" pill — falls through to proxy when name is changed', async ({
    page,
  }) => {
    await page.getByTestId("ctx-name").fill("Alem");

    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Who am I?" });
    await expect(pill.first()).toBeVisible({ timeout: 15_000 });
    await pill.first().click();

    // Confirm the click registered by waiting for the user-side echo.
    const userMsg = page.locator('[data-testid="copilot-user-message"]');
    await expect(
      userMsg
        .filter({ hasText: "What do you know about me from my context" })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Locked phrase from fixture d5-all.json:1614. If the gate
    // regresses (e.g. drops the name discriminator) this phrase will
    // appear and the test fails.
    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant.filter({ hasText: "I see you're Atai" }).first(),
    ).not.toBeVisible({ timeout: 15_000 });
  });

  test('"Suggest next steps" pill — falls through to proxy when an activity is toggled', async ({
    page,
  }) => {
    // Add a non-default activity. The full default activity-list
    // substring no longer appears in the system message and the fixture
    // misses.
    await page.getByTestId("activity-invited-a-teammate").click();

    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Suggest next steps" });
    await expect(pill.first()).toBeVisible({ timeout: 15_000 });
    await pill.first().click();

    const userMsg = page.locator('[data-testid="copilot-user-message"]');
    await expect(
      userMsg
        .filter({
          hasText: "Based on my recent activity, what should I try next",
        })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant
        .filter({
          hasText:
            "Since you recently viewed the pricing page and watched the product demo video",
        })
        .first(),
    ).not.toBeVisible({ timeout: 15_000 });
  });

  test('"Plan my morning" pill — falls through to proxy when timezone is changed', async ({
    page,
  }) => {
    await page.getByTestId("ctx-timezone").selectOption("Europe/London");

    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Plan my morning" });
    await expect(pill.first()).toBeVisible({ timeout: 15_000 });
    await pill.first().click();

    const userMsg = page.locator('[data-testid="copilot-user-message"]');
    await expect(
      userMsg
        .filter({
          hasText:
            "What time is it in my timezone and what should I do for the next hour",
        })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const assistant = page.locator('[data-testid="copilot-assistant-message"]');
    await expect(
      assistant
        .filter({
          hasText:
            "Atai, I don't have live clock access here, but your timezone is America/Los_Angeles",
        })
        .first(),
    ).not.toBeVisible({ timeout: 15_000 });
  });
});
