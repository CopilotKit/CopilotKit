/**
 * Visual regression for the shell-dashboard feature matrix at 3 viewports
 * under 3 synthetic PB states: all-green, mixed, all-unknown.
 *
 * This suite expects a dev server at DASHBOARD_URL (default
 * http://localhost:3002) AND a route-interceptor mock of the PB subscribe
 * stream. When the dev server isn't running, tests fail loud — we do NOT
 * boot a server automatically because the predev prober can hit external
 * URLs and introduce flake.
 *
 * To seed state we intercept the REST endpoints the PB JS SDK hits for
 * `collection("status").getFullList` — `/api/collections/status/records`
 * — and return fixture rows. SSE `/api/realtime` is returned empty so the
 * client stays on its initial snapshot.
 */
import { test, expect } from "@playwright/test";

type StateLabel = "all-green" | "mixed" | "all-unknown";

const INTEGRATIONS = ["agno", "crewai-crews", "langroid"];
const FEATURES = ["agentic-chat", "human-in-the-loop"];

function fixtureFor(label: StateLabel): Array<Record<string, unknown>> {
  if (label === "all-unknown") return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const slug of INTEGRATIONS) {
    rows.push({
      id: `h-${slug}`,
      key: `health:${slug}`,
      dimension: "health",
      state:
        label === "all-green" ? "green" : slug === "agno" ? "red" : "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    });
    for (const feat of FEATURES) {
      for (const dim of ["smoke", "e2e", "qa"]) {
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
  // Short-circuit the SSE realtime endpoint so the client stays on the
  // snapshot we returned above.
  await page.route(/\/api\/realtime/, async (route) => {
    await route.abort("blockedbyclient");
  });
}

for (const label of ["all-green", "mixed", "all-unknown"] as const) {
  test(`matrix-${label}`, async ({ page }) => {
    await seedPb(page, label);
    await page.goto("/");
    // Deterministic wait: the shell-dashboard `live-indicator` carries a
    // `data-status` attribute that settles to "offline" once the SSE
    // connection attempt fails (our route.abort above forces this). Pre-
    // fix this block used `waitForTimeout(1500)` — a real-clock race
    // prone to flake under load, and that silently accepted partially-
    // rendered screenshots. Waiting on `data-status="offline"` is the
    // same visual end-state we screenshot.
    await page
      .locator('[data-testid="live-indicator"][data-status="offline"]')
      .first()
      .waitFor({ state: "attached", timeout: 5000 });
    await expect(page).toHaveScreenshot(`matrix-${label}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
