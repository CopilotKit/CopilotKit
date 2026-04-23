/**
 * E2E tests for self-contained demo pages.
 *
 * These tests verify that the reverted self-contained demos load correctly
 * and show the expected UI components with real content verification.
 * They do NOT require a running agent backend -- only the Next.js frontend
 * (demos render their UI even without an agent connection, showing loading
 * states or empty chat).
 *
 * Suggestions are rendered client-side by CopilotKit hooks and should be
 * visible even without an agent backend.
 *
 * Note on id/route gap: some demos are described by a canonical manifest id
 * (e.g. "hitl-in-chat") but are served from a shorter legacy route path
 * (e.g. "/demos/hitl"). Test describe() blocks below use the canonical id
 * while page.goto() targets the actual route — this is intentional.
 *
 * To run with aimock (deterministic LLM responses for agent-dependent tests):
 *   npx aimock --fixtures showcase/aimock --port 4010 --validate-on-load &
 *   cd showcase/packages/langgraph-python
 *   OPENAI_BASE_URL=http://localhost:4010/v1 OPENAI_API_KEY=test-key pnpm dev &
 *   cd ../../scripts
 *   BASE_URL=http://localhost:3000 npx playwright test __tests__/e2e/demo-e2e.spec.ts
 *
 * To run against a package:
 *   cd showcase/packages/langgraph-python
 *   pnpm dev &
 *   cd ../../scripts
 *   BASE_URL=http://localhost:3000 npx playwright test __tests__/e2e/demo-e2e.spec.ts
 */

import { test, expect } from "@playwright/test";

test.describe("Demo: agentic-chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat");
    // Wait for the chat input to confirm hydration
    await expect(
      page.locator('textarea[placeholder^="Type a message"]'),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("page loads with chat input and styled background container", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toHaveCSS("background-color", "rgb(250, 250, 249)");
  });

  test("suggestion buttons are rendered with correct text", async ({
    page,
  }) => {
    // The agentic-chat demo configures two suggestions via useConfigureSuggestions
    // CopilotKit renders these as clickable elements in the chat UI
    await expect(page.getByText("Change background")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Generate sonnet")).toBeVisible();
  });

  test("clicking a suggestion populates the chat input", async ({ page }) => {
    // Wait for suggestions to render
    const suggestion = page.getByText("Change background");
    await expect(suggestion).toBeVisible({ timeout: 10000 });

    // Click the suggestion
    await suggestion.click();

    // The chat input should now contain the suggestion's message text,
    // or the message should appear in the chat as a sent message.
    //
    // The branching below is intentional: CopilotKit's suggestion click
    // handler is not deterministic across package implementations — some
    // suggestion configurations populate the input (so the user can edit
    // before sending), others send immediately. We race against both
    // outcomes and assert the matching one. Failures in either branch
    // surface concretely: the "populated" branch fails with a substring
    // mismatch on the input value, the "sent" branch fails with a
    // visibility timeout on the chat message.
    //
    // Reading inputValue() immediately after click() races the click
    // handler — the read can resolve before the handler runs, putting us
    // into the "sent" branch incorrectly and producing a confusing 5s
    // visibility timeout. Wait until either outcome is observably true
    // before branching.
    const input = page.locator('textarea[placeholder^="Type a message"]');
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder^="Type a message"]',
        );
        const hasValue = !!textarea && textarea.value.length > 0;
        const hasSentMessage =
          document.querySelector(".copilotKitUserMessage") !== null;
        return hasValue || hasSentMessage;
      },
      undefined,
      { timeout: 10000 },
    );
    const inputValue = await input.inputValue();

    if (inputValue) {
      // Suggestion populated the input -- verify it contains relevant text
      expect(inputValue.toLowerCase()).toContain("background");
    } else {
      // Suggestion was sent as a message -- verify it appears in the chat
      await expect(
        page.getByText(/Change the background to something new/i),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Demo: hitl-in-chat (Human in the Loop)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
    await expect(
      page.locator('textarea[placeholder^="Type a message"]'),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("page loads with CopilotChat in a centered max-width container", async ({
    page,
  }) => {
    // The HITL demo renders CopilotChat inside a max-w-4xl centered container
    const container = page.locator(".max-w-4xl").first();
    await expect(container).toBeVisible();

    // The chat input should be inside this container
    await expect(
      container.locator('textarea[placeholder^="Type a message"]'),
    ).toBeVisible();
  });

  test("suggestion buttons are rendered with correct text", async ({
    page,
  }) => {
    // The HITL demo configures two suggestions: "Simple plan" and "Complex plan"
    await expect(page.getByText("Simple plan")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Complex plan")).toBeVisible();
  });

  test("clicking a suggestion populates the chat or sends the message", async ({
    page,
  }) => {
    const suggestion = page.getByText("Simple plan");
    await expect(suggestion).toBeVisible({ timeout: 10000 });

    await suggestion.click();

    // Intentional branching: same non-deterministic race as in the
    // agentic-chat suite — suggestion click may populate the input or
    // send the message immediately depending on the package's
    // useConfigureSuggestions wiring. Each branch asserts its own
    // concrete outcome so a regression fails with a clear error (either
    // an input substring mismatch or a chat message visibility
    // timeout), not a generic both-branches-false failure.
    //
    // Wait for an observable outcome before reading inputValue() — the
    // raw read races the click handler and can misroute us into the
    // "sent" branch with a confusing 5s timeout.
    const input = page.locator('textarea[placeholder^="Type a message"]');
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder^="Type a message"]',
        );
        const hasValue = !!textarea && textarea.value.length > 0;
        const hasSentMessage =
          document.querySelector(".copilotKitUserMessage") !== null;
        return hasValue || hasSentMessage;
      },
      undefined,
      { timeout: 10000 },
    );
    const inputValue = await input.inputValue();

    if (inputValue) {
      // Populated the input
      expect(inputValue.toLowerCase()).toContain("trip to mars");
    } else {
      // Sent as a message
      await expect(page.getByText(/plan a trip to mars/i)).toBeVisible({
        timeout: 5000,
      });
    }
  });
});

test.describe("Demo: tool-rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering");
    await expect(
      page.locator('textarea[placeholder^="Type a message"]'),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("page loads with CopilotChat in a centered full-height layout", async ({
    page,
  }) => {
    // The tool-rendering demo wraps CopilotChat in a full-height container
    const chatContainer = page.locator(".h-full").first();
    await expect(chatContainer).toBeVisible();
  });

  test("weather suggestion buttons are rendered with specific city text", async ({
    page,
  }) => {
    // The tool-rendering demo configures three weather suggestions with specific cities
    await expect(page.getByText("Weather in San Francisco")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Weather in New York")).toBeVisible();
    await expect(page.getByText("Weather in Tokyo")).toBeVisible();
  });

  test("clicking a weather suggestion populates the chat or sends the message", async ({
    page,
  }) => {
    const suggestion = page.getByText("Weather in San Francisco");
    await expect(suggestion).toBeVisible({ timeout: 10000 });

    await suggestion.click();

    // Intentional branching: same non-deterministic race as in the
    // other demo suites — suggestion click may populate the input or
    // send the message immediately. Each branch asserts its own
    // concrete outcome so the failure mode (input substring mismatch
    // vs. chat-message visibility timeout) stays diagnosable.
    //
    // Wait for an observable outcome before reading inputValue() — the
    // raw read races the click handler and can misroute us into the
    // "sent" branch with a confusing 5s timeout.
    const input = page.locator('textarea[placeholder^="Type a message"]');
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder^="Type a message"]',
        );
        const hasValue = !!textarea && textarea.value.length > 0;
        const hasSentMessage =
          document.querySelector(".copilotKitUserMessage") !== null;
        return hasValue || hasSentMessage;
      },
      undefined,
      { timeout: 10000 },
    );
    const inputValue = await input.inputValue();

    if (inputValue) {
      // Populated the input with the weather question
      expect(inputValue.toLowerCase()).toContain("san francisco");
    } else {
      // Sent as a message in the chat
      await expect(page.getByText(/weather.*san francisco/i)).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
