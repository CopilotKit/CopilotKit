// Helpers for the Beautiful Chat specs: open the demo page of the
// integration under test and click its suggestion pills.
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath } from "./helpers";

/** The titles of the demo's suggestion pills, in the order they render. */
export const beautifulChatPills = [
  "Pie Chart (Controlled Generative UI)",
  "Bar Chart (Controlled Generative UI)",
  "Schedule Meeting (Human In The Loop)",
  "Search Flights (A2UI Fixed Schema)",
  "Sales Dashboard (A2UI Dynamic)",
  "Excalidraw Diagram (MCP App)",
  "Calculator App (Open Generative UI)",
  "Toggle Theme (Frontend Tools)",
  "Task Manager (Shared State)",
] as const;

export type BeautifulChatPill = (typeof beautifulChatPills)[number];

/**
 * Opens the Beautiful Chat page and waits for a suggestion pill. A click
 * before hydration can do nothing, and all pills mount in the same render,
 * so one visible pill means the page takes clicks.
 *
 * @param page - The Playwright page.
 *
 * @example
 * test.beforeEach(async ({ page }) => {
 *   await openBeautifulChat(page);
 * });
 */
export async function openBeautifulChat(page: Page) {
  await page.goto(demoPath("beautiful-chat"));
  await expect(
    page.getByRole("button", { name: "Toggle Theme (Frontend Tools)" }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Clicks a suggestion pill when it is visible. The pill sends its prompt to
 * the agent.
 *
 * @param page - The Playwright page.
 * @param name - The pill's title.
 *
 * @example
 * await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");
 */
export async function clickBeautifulChatPill(
  page: Page,
  name: BeautifulChatPill,
) {
  const pill = page.getByRole("button", { name });
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
}
