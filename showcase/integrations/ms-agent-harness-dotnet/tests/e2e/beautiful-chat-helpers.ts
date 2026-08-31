import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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

export async function openBeautifulChat(page: Page) {
  await page.goto("/demos/beautiful-chat");
  await expect(
    page.getByRole("button", { name: "Toggle Theme (Frontend Tools)" }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function clickBeautifulChatPill(
  page: Page,
  name: BeautifulChatPill,
) {
  const pill = page.getByRole("button", { name });
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
}
