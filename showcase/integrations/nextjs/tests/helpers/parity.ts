import { Page, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import yaml from "yaml";

export async function openUnifiedDemo(
  page: Page,
  framework: string,
  demoId: string,
): Promise<void> {
  await page.goto(`/demos/${framework}/${demoId}`);
  await expect(page.locator('[data-testid="background-container"]')).toBeVisible({
    timeout: 15_000,
  });
}

export async function sendAndAwait(page: Page, message: string): Promise<string> {
  // Selectors should match CopilotChat's data-testids — verify against
  // a running chat surface during smoke and adjust here if needed.
  await page.fill('[data-testid="copilot-chat-input"]', message);
  await page.click('[data-testid="copilot-chat-send"]');
  const last = page.locator('[data-testid="copilot-chat-message-assistant"]').last();
  await expect(last).toBeVisible({ timeout: 30_000 });
  return (await last.textContent()) ?? "";
}

/**
 * Returns sorted list of framework slugs that declare support for the
 * given demo id in their `agents/<fw>/manifest.yaml`. Read at test-collection
 * time so adding a new framework's manifest auto-includes it in the matrix.
 */
export function frameworksSupportingDemo(demoId: string): string[] {
  const agentsDir = path.resolve(__dirname, "../../../agents");
  if (!fs.existsSync(agentsDir)) return [];
  const out: string[] = [];
  for (const slug of fs.readdirSync(agentsDir)) {
    const mPath = path.join(agentsDir, slug, "manifest.yaml");
    if (!fs.existsSync(mPath)) continue;
    const m = yaml.parse(fs.readFileSync(mPath, "utf-8"));
    if (m?.demos?.some((d: any) => d.id === demoId)) out.push(slug);
  }
  return out.sort();
}
