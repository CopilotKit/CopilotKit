import { test, expect } from "@playwright/test";

/**
 * Headless = bring-your-own-UI. The cell exercises the minimum-viable
 * headless chat: useAgent + useCopilotKit, dressed in shadcn primitives,
 * no tool rendering, no generative UI — just text in / text out via a
 * hand-rolled UI.
 *
 * The 4-test plan drives the 3 empty-state pills and asserts the
 * deterministic aimock fixture leading phrases land in the custom
 * assistant bubble (`[data-testid="headless-message-assistant"]`).
 *
 * If the headless surface ever regressed to the default <CopilotChat />
 * surface, the headless-specific testid would be missing and tests 2-4
 * would fail. If a fixture-matcher misroute swapped one pill's response
 * for another's, the wrong leading phrase would surface.
 */

const PILL_HELLO = "Say hello in one short sentence.";
const PILL_JOKE = "Tell me a one-line joke.";
const PILL_FACT = "Give me a fun fact.";

// Intentionally NOT the showcase-assistant catch-all phrase ("Hello! I can
// help you with weather lookups, creating pie and bar charts...") — that
// boilerplate is what other tests in this PR explicitly guard AGAINST.
// The dedicated d5-all.json fixture for "Say hello in one short sentence"
// returns the leading phrase below; if fixture priority ever misroutes
// this prompt to the catch-all, this assertion will fail with a clear
// "expected non-boilerplate greeting" diff.
const HELLO_LEADING = "Hi! In one short sentence: I'm a CopilotKit demo agent";
const JOKE_LEADING =
  "Why did the scarecrow win an award? Because he was outstanding in his field!";
const FACT_LEADING = "A fun fact: Honey never spoils!";

const ASSERT_TIMEOUT = 30_000;

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with custom composer and three suggestion pills", async ({
    page,
  }) => {
    // Custom composer is the structural signal that the demo is headless;
    // no default CopilotChat input is rendered on this surface.
    await expect(
      page.locator('[data-testid="headless-composer"]'),
    ).toBeVisible();

    // The 3 empty-state pills are hand-rolled <button>s containing the
    // verbatim sample prompts.
    await expect(
      page.getByRole("button", { name: PILL_HELLO, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_JOKE, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_FACT, exact: true }),
    ).toBeVisible();
  });

  test("clicking the hello pill renders the deterministic greeting in the custom assistant bubble", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_HELLO, exact: true }).click();

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(HELLO_LEADING, {
      timeout: ASSERT_TIMEOUT,
    });
  });

  test("clicking the joke pill renders the deterministic joke in the custom assistant bubble", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_JOKE, exact: true }).click();

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(JOKE_LEADING, {
      timeout: ASSERT_TIMEOUT,
    });
  });

  test("clicking the fun fact pill renders the deterministic fun fact in the custom assistant bubble", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_FACT, exact: true }).click();

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(FACT_LEADING, {
      timeout: ASSERT_TIMEOUT,
    });
  });
});
