import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("renders hand-rolled chrome without CopilotChat primitives", async ({
    page,
  }) => {
    // Custom header (<h1> + subtext) — this cell does not render
    // <CopilotChat /> or <CopilotChatMessageView />.
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
    await expect(
      page.getByText("Built from scratch on useAgent — no CopilotChat."),
    ).toBeVisible();

    // The scrollable messages container is the only data-testid in the demo.
    await expect(
      page.locator('[data-testid="headless-complete-messages"]'),
    ).toBeVisible();

    // Empty-state hint is rendered inside the messages container.
    await expect(
      page.getByText(
        "Try weather, a stock, a highlighted note, or an Excalidraw sketch.",
      ),
    ).toBeVisible();

    // Custom composer — placeholder + disabled Send button.
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeVisible();
    await expect(send).toBeDisabled();

    // No built-in CopilotChat testids should be present.
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="copilot-message-list"]'),
    ).toHaveCount(0);
  });

  test("Send enables on input and sends a message through the hand-rolled run", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder("Type a message...");
    const send = page.getByRole("button", { name: "Send", exact: true });

    await expect(send).toBeDisabled();
    await textarea.fill("hello");
    await expect(send).toBeEnabled();
    await send.click();

    // Messages container should now contain the user's verbatim "hello".
    const messages = page.locator('[data-testid="headless-complete-messages"]');
    await expect(messages).toContainText("hello", { timeout: 10000 });

    // Empty-state hint should be gone once a message was sent.
    await expect(
      page.getByText(
        "Try weather, a stock, a highlighted note, or an Excalidraw sketch.",
      ),
    ).toHaveCount(0);

    // Textarea clears on submit.
    await expect(textarea).toHaveValue("");
  });

  test("weather prompt renders the custom WeatherCard via useRenderTool", async ({
    page,
  }) => {
    // aimock fixture for userMessage "weather" returns a `get_weather`
    // tool call with location Tokyo. The cell registers a per-tool renderer
    // for `get_weather` → <WeatherCard />. Asserting on the WeatherCard's
    // verbatim eyebrow + location text proves the manual useRenderToolCall
    // path in use-rendered-messages.tsx is wired correctly.
    const textarea = page.getByPlaceholder("Type a message...");
    await textarea.fill("what's the weather in Tokyo");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const messages = page.locator('[data-testid="headless-complete-messages"]');

    // Card eyebrow flips from "Fetching weather" -> "Weather" once complete.
    // Using `.first()` because the agent can render multiple WeatherCard
    // eyebrow divs as it streams (loading card first, then a fresh settled
    // card on result) and both have the same "Weather" text — strict mode
    // would otherwise fail on the dup.
    await expect(
      messages.getByText("Weather", { exact: true }).first(),
    ).toBeVisible({ timeout: 45000 });

    // Location label renders the fixture-supplied "Tokyo".
    await expect(
      messages.getByText("Tokyo", { exact: true }).first(),
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("multi-turn conversation preserves history", async ({ page }) => {
    const textarea = page.getByPlaceholder("Type a message...");
    const send = () => page.getByRole("button", { name: "Send", exact: true });

    // Turn 1
    await textarea.fill("hi");
    await send().click();
    const messages = page.locator('[data-testid="headless-complete-messages"]');
    await expect(messages).toContainText("hi", { timeout: 30000 });

    // Turn 2 — the user bubble wrapper has `rounded-br-sm` as a structural
    // marker. After two turns there should be at least two such bubbles in
    // the transcript.
    await textarea.fill("hello");
    await send().click();

    await expect
      .poll(
        async () =>
          await page
            .locator(
              '[data-testid="headless-complete-messages"] div.rounded-br-sm',
            )
            .count(),
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(2);
  });

  test("clicks the Largest continent suggestion and renders the canonical answer", async ({
    page,
  }) => {
    const chips = page.locator('[data-testid="headless-suggestions"]');
    await expect(chips).toBeVisible();

    await chips.getByRole("button", { name: "Largest continent" }).click();

    const messages = page.locator('[data-testid="headless-complete-messages"]');
    await expect(messages).toContainText("What is the largest continent?", {
      timeout: 10000,
    });

    // aimock fixture returns "Asia is the largest continent — ..."
    await expect(messages.getByText(/Asia/).first()).toBeVisible({
      timeout: 30000,
    });
  });
});
