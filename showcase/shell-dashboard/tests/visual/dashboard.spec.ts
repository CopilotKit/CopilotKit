/**
 * Visual regression for the shell-dashboard feature matrix at 3 viewports
 * under 3 synthetic PB states: all-green, mixed, all-unknown.
 *
 * Phase 3: e2e→e2e, qa removed, agent/chat/tools added for strip.
 */
import { test, expect } from "@playwright/test";

type StateLabel = "all-green" | "mixed" | "all-unknown";

const INTEGRATIONS = ["agno", "crewai-crews", "langroid"];
const FEATURES = ["agentic-chat", "human-in-the-loop"];

function fixtureFor(label: StateLabel): Array<Record<string, unknown>> {
  if (label === "all-unknown") return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const slug of INTEGRATIONS) {
    // Integration-level dimensions for strip
    for (const dim of ["health", "agent", "chat", "tools"]) {
      rows.push({
        id: `${dim}-${slug}`,
        key: `${dim}:${slug}`,
        dimension: dim,
        state:
          label === "all-green"
            ? "green"
            : dim === "health" && slug === "agno"
              ? "red"
              : "green",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      });
    }
    // Feature-level dimensions
    for (const feat of FEATURES) {
      for (const dim of ["smoke", "e2e"]) {
        const state =
          label === "all-green"
            ? "green"
            : dim === "smoke" && slug === "crewai-crews"
              ? "degraded"
              : dim === "e2e" && feat === "human-in-the-loop"
                ? "red"
                : "green";
        rows.push({
          id: `${dim}-${slug}-${feat}`,
          key: `${dim}:${slug}/${feat}`,
          dimension: dim,
          state,
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 0,
          first_failure_at: null,
        });
      }
    }
  }
  return rows;
}

async function seedPb(
  page: import("@playwright/test").Page,
  label: StateLabel,
): Promise<void> {
  await page.route(/\/api\/collections\/status\/records/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        page: 1,
        perPage: 500,
        totalItems: fixtureFor(label).length,
        totalPages: 1,
        items: fixtureFor(label),
      }),
    });
  });
  await page.route(/\/api\/realtime/, async (route) => {
    await route.abort("blockedbyclient");
  });
}

for (const label of ["all-green", "mixed", "all-unknown"] as const) {
  test(`matrix-${label}`, async ({ page }) => {
    await seedPb(page, label);
    await page.goto("/");
    await page
      .locator('[data-testid="live-indicator"][data-status="error"]')
      .first()
      .waitFor({ state: "attached", timeout: 10000 });
    await expect(page).toHaveScreenshot(`matrix-${label}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
