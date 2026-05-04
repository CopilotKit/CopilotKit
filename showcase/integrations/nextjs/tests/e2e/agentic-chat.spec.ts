import { test, expect } from "@playwright/test";
import { openUnifiedDemo, sendAndAwait, frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "agentic-chat";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders chat composer", async ({ page }) => {
      await openUnifiedDemo(page, fw, DEMO);
      await expect(page.locator('[data-testid="copilot-chat-input"]')).toBeVisible();
    });

    test("agent responds to a basic message", async ({ page }) => {
      await openUnifiedDemo(page, fw, DEMO);
      const reply = await sendAndAwait(page, "Say the word 'parity' verbatim.");
      expect(reply.toLowerCase()).toContain("parity");
    });

    test("change_background frontend tool fires", async ({ page }) => {
      await openUnifiedDemo(page, fw, DEMO);
      await sendAndAwait(page, "Change the background to red.");
      const bg = await page.locator('[data-testid="background-container"]').evaluate(
        (el) => getComputedStyle(el as HTMLElement).background,
      );
      expect(bg.toLowerCase()).toMatch(/red|rgb\(255/);
    });
  });
}
