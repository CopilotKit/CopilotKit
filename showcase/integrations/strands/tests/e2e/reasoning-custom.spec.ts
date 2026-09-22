import { test, expect } from "@playwright/test";

// QA reference: qa/reasoning-custom.md
// Demo source: src/app/demos/reasoning-custom/{page.tsx, reasoning-block.tsx}
//
// The demo mounts a custom `reasoningMessage` slot (`ReasoningBlock`) that
// renders an amber banner with `data-testid="reasoning-block"`. The label
// inside the banner reads "Thinking…" while the agent is streaming, then
// flips to "Agent reasoning" once streaming settles. The backend uses
// `deepagents.create_deep_agent` with a reasoning-capable OpenAI model
// (`gpt-5-mini` by default, override via `OPENAI_REASONING_MODEL`) routed
// through the Responses API so the model's chain of thought streams as
// AG-UI REASONING_MESSAGE_* events.
//
// Streaming assertions exercise the aimock fixture in
// `showcase/aimock/d5-all.json` — its `reasoning` field makes aimock emit
// `response.reasoning_summary_text.delta` events deterministically, no
// real LLM call required. Local stack: a "Show reasoning" suggestion pill
// fires the same prompt, so a single click reproduces the streaming UX.
//
// Selectors are testid / role / stable text only. No LLM-text assertions.

const REASONING_PROMPT = "show your reasoning step by step";

test.describe("Reasoning: Custom", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-custom");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("send button is visible alongside the input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-send-button"]').first(),
    ).toBeVisible();
  });

  test("typing a prompt and submitting does not crash the UI", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello in one short sentence.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(input).toHaveValue("", { timeout: 10_000 });
  });

  // --- Reasoning-block streaming coverage --------------------------------

  test("reasoning prompt renders a reasoning-block before the answer", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(REASONING_PROMPT);
    await page.locator('[data-testid="copilot-send-button"]').first().click();

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
    const input = page.getByPlaceholder("Type a message");
    await input.fill(REASONING_PROMPT);
    await page.locator('[data-testid="copilot-send-button"]').first().click();

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
    const input = page.getByPlaceholder("Type a message");
    await input.fill(REASONING_PROMPT);
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
    // ReasoningBlock renders content inside a div with italic class when
    // `message.content` is non-empty (see reasoning-block.tsx).
    await expect(reasoningBlock.locator(".italic")).toBeVisible({
      timeout: 45_000,
    });
  });

  test("Show reasoning suggestion pill fires the reasoning prompt", async ({
    page,
  }) => {
    // The page wires `useConfigureSuggestions` with a single "Show reasoning"
    // pill whose message exactly matches the aimock fixture key.
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    const reasoningBlock = page
      .locator('[data-testid="reasoning-block"]')
      .first();
    await expect(reasoningBlock).toBeVisible({ timeout: 60_000 });
  });
});
