import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("renders custom composer chrome instead of CopilotChat", async ({
    page,
  }) => {
    // Heading is a hand-rolled <h1> — not a chat primitive. If the demo
    // ever regressed to rendering <CopilotChat /> it would not exist here.
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();

    // Empty-state helper text is rendered inside the message panel before
    // any messages land.
    await expect(page.getByText("No messages yet. Say hi!")).toBeVisible();

    // Verbatim placeholder on the custom composer textarea (not the default
    // CopilotKit "Type a message" placeholder) — this is the clearest
    // structural signal the composer is hand-rolled.
    await expect(
      page.getByPlaceholder(
        "Type a message. Ask me to 'show a card about cats'.",
      ),
    ).toBeVisible();

    // The custom Send button is a plain <button>. Disabled on empty input.
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeVisible();
    await expect(send).toBeDisabled();

    // No default CopilotChat testids should be present — this cell is
    // truly headless.
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="copilot-send-button"]'),
    ).toHaveCount(0);
  });

  test("Send button enables once textarea has content", async ({ page }) => {
    const textarea = page.getByPlaceholder(
      "Type a message. Ask me to 'show a card about cats'.",
    );
    const send = page.getByRole("button", { name: "Send", exact: true });

    await expect(send).toBeDisabled();
    await textarea.fill("Hello");
    await expect(send).toBeEnabled();
  });

  test("sends a message and renders the user bubble", async ({ page }) => {
    // The round-trip user bubble is the most reliable structural signal —
    // it's rendered synchronously from agent.messages as soon as the send
    // handler calls `agent.addMessage({ role: "user", ... })`. The assistant
    // response reliability depends on the upstream LangGraph deployment
    // plumbing through to aimock, so we keep this test scoped to the
    // frontend composer's verified behavior.
    const textarea = page.getByPlaceholder(
      "Type a message. Ask me to 'show a card about cats'.",
    );
    await textarea.fill("hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // User bubble: self-end + bg-blue-600 are structural utility classes
    // applied only to the user bubble in this cell.
    const userBubble = page.locator("div.self-end.bg-blue-600").first();
    await expect(userBubble).toBeVisible({ timeout: 10000 });
    await expect(userBubble).toHaveText("hello");

    // Empty-state text is gone after the first send.
    await expect(page.getByText("No messages yet. Say hi!")).toHaveCount(0);

    // Textarea clears after send.
    await expect(textarea).toHaveValue("");
  });

  test("thinking indicator appears while agent is running", async ({
    page,
  }) => {
    // The "Agent is thinking..." helper is rendered whenever `agent.isRunning`
    // is true. Sending any message flips that bit to true for the duration of
    // the round-trip, so the indicator should surface.
    const textarea = page.getByPlaceholder(
      "Type a message. Ask me to 'show a card about cats'.",
    );
    await textarea.fill("hello");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("Agent is thinking...")).toBeVisible({
      timeout: 10000,
    });
  });
});
