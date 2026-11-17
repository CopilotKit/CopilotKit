import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Headless = bring-your-own-UI. The demo is the minimum headless chat:
// useAgent + useCopilotKit, dressed in shadcn primitives, with no tool
// rendering and no generative UI. Text goes in and comes out through a
// hand-rolled UI.
//
// The tests click the 3 empty-state pills and check that the deterministic
// aimock reply lands in the custom assistant bubble
// (`[data-testid="headless-message-assistant"]`).
//
// If the page falls back to the default <CopilotChat />, the headless test
// ids are missing and the reply tests fail. If the fixture matcher swaps
// the replies of two pills, the wrong leading phrase shows.

const ASSERT_TIMEOUT = 30_000;

// Each pill sends its own prompt, and the aimock fixture for that prompt
// replies with the leading phrase below. None of them is the catch-all
// greeting ("Hello! I can help you with weather lookups, creating pie and
// bar charts..."), so a prompt that falls through to the catch-all fails
// with a clear diff.
const PILLS = [
  {
    pill: "hello",
    reply: "greeting",
    prompt: "Say hello in one short sentence.",
    leading: "Hi! In one short sentence: I'm a CopilotKit demo agent",
  },
  {
    pill: "joke",
    reply: "joke",
    prompt: "Tell me a one-line joke.",
    leading:
      "Why did the scarecrow win an award? Because he was outstanding in his field!",
  },
  {
    pill: "fun fact",
    reply: "fun fact",
    prompt: "Give me a fun fact.",
    leading: "A fun fact: Honey never spoils!",
  },
];

// The pills are hand-rolled <button>s that hold the sample prompts verbatim.
function pillButton(page: Page, prompt: string) {
  return page.getByRole("button", { name: prompt, exact: true });
}

describeDemo("headless-simple", "Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("headless-simple"));
  });

  test("page loads with custom composer and three suggestion pills", async ({
    page,
  }) => {
    // The custom composer is the structural signal that the demo is
    // headless: no default CopilotChat input renders on this page.
    await expect(
      page.locator('[data-testid="headless-composer"]'),
    ).toBeVisible();

    for (const { prompt } of PILLS) {
      await expect(pillButton(page, prompt)).toBeVisible();
    }
  });

  for (const { pill, reply, prompt, leading } of PILLS) {
    test(`clicking the ${pill} pill renders the deterministic ${reply} in the custom assistant bubble`, async ({
      page,
    }) => {
      await pillButton(page, prompt).click();

      const assistant = page
        .locator('[data-testid="headless-message-assistant"]')
        .first();
      await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
      await expect(assistant).toContainText(leading, {
        timeout: ASSERT_TIMEOUT,
      });
    });
  }
});
