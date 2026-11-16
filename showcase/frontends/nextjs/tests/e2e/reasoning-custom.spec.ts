import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// The demo overrides the `reasoningMessage` slot with `ReasoningBlock`, a
// banner with `data-testid="reasoning-block"`. Its label reads "Thinking…"
// while the agent streams, then "Agent reasoning".
//
// The reasoning prompt matches the integration's aimock fixture, whose
// `reasoning` field streams reasoning deterministically, with no real model
// call. The "Show reasoning" suggestion sends a prompt that a fixture also
// matches.
//
// Selectors are test ids, roles and fixed UI text only. No assertion reads
// model text.

const REASONING_PROMPT = "show your reasoning step by step";
const SEND_BUTTON = '[data-testid="copilot-send-button"]';

async function sendFromComposer(page: Page, text: string) {
  await page.getByPlaceholder("Type a message").fill(text);
  await page.locator(SEND_BUTTON).first().click();
}

describeDemo("reasoning-custom", "Reasoning: Custom", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("reasoning-custom"));
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("send button is visible alongside the input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.locator(SEND_BUTTON).first()).toBeVisible();
  });

  test("typing a prompt and submitting does not crash the UI", async ({
    page,
  }) => {
    await sendFromComposer(page, "Say hello in one short sentence.");

    await expect(page.getByPlaceholder("Type a message")).toHaveValue("", {
      timeout: 10_000,
    });
  });

  test("reasoning prompt renders a reasoning-block before the answer", async ({
    page,
  }) => {
    await sendFromComposer(page, REASONING_PROMPT);

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
    await expect(
      reasoningBlock.getByText("Reasoning", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("reasoning-block label flips from Thinking to Agent reasoning", async ({
    page,
  }) => {
    await sendFromComposer(page, REASONING_PROMPT);

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
    await expect(reasoningBlock.getByText("Agent reasoning")).toBeVisible({
      timeout: 90_000,
    });
  });

  test("reasoning-block accumulates italic reasoning content", async ({
    page,
  }) => {
    await sendFromComposer(page, REASONING_PROMPT);

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
    // ReasoningBlock renders non-empty reasoning in an italic <div>.
    await expect(reasoningBlock.locator(".italic")).toBeVisible({
      timeout: 45_000,
    });
  });

  test("Show reasoning suggestion pill fires the reasoning prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
  });
});
