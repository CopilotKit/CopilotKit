import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const HUD_FEED_URL = "https://cdn.copilotkit.ai/inspector-hud/v1.json";
const NOTIFICATION_FEED_URL =
  "https://cdn.copilotkit.ai/notifications/v1.json*";
const LAB_URL =
  "/?scenario=oss-intelligence-disabled&sdk-framework=react&sdk-version=1.78.0&replay-notification=1&reset=1";
const SCREENSHOT_DIR = process.env.HUD_SCREENSHOT_DIR;
const LONGEST_LABEL = "W".repeat(32);
const LONGEST_DESCRIPTION =
  "Open any past conversation with its full state, every message, tool call and agent step, then pick up exactly where the last run left off!!!";

type FeedResponse = NonNullable<Parameters<Route["fulfill"]>[0]>;

function feed(
  features: Record<string, Record<string, string>>,
  sdkVersion = ">=1.78.0 <2.0.0",
): FeedResponse {
  return {
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: 1,
      rules: [{ framework: "react", sdkVersion, features }],
    }),
  };
}

/** Serve the HUD feed and keep the notification feed off the network. */
async function openLab(page: Page, response: FeedResponse): Promise<void> {
  const hudRequests: string[] = [];
  await page.route(NOTIFICATION_FEED_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, notifications: [] }),
    }),
  );
  await page.route(HUD_FEED_URL, (route) => {
    hudRequests.push(route.request().url());
    return route.fulfill(response);
  });
  await page.goto(LAB_URL);
  await expect(page.locator("body")).toHaveAttribute("data-lab-ready", "true");
  await expect.poll(() => hudRequests).toEqual([HUD_FEED_URL]);
  await page.locator(".console-button-wrapper").hover();
  await expect(page.locator("[data-cpk-launcher-hud]")).toBeVisible();
}

function row(page: Page, id: string) {
  return page.locator(`[data-cpk-hud-row="${id}"]`);
}

async function expectTooltip(
  page: Page,
  id: string,
  text: string,
): Promise<void> {
  await row(page, id).locator("[data-cpk-hud-learn-more]").hover();
  const tooltip = row(page, id).getByRole("tooltip");
  await expect(tooltip).toHaveText(text);
  await expect(tooltip).toHaveCSS("opacity", "1");
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

async function expectBuiltInContent(page: Page): Promise<void> {
  await expect(
    row(page, "threads").locator("[data-cpk-hud-action]"),
  ).toHaveText("Rich Threads");
  await expect(
    row(page, "learning").locator("[data-cpk-hud-action]"),
  ).toHaveText("Automatic Learning");
  await expectTooltip(page, "threads", "Click to learn more");
  await row(page, "threads").locator("[data-cpk-hud-action]").click();
  await expect(
    page.locator('button[data-inspector-menu-key][aria-current="page"]'),
  ).toHaveAttribute("data-inspector-menu-key", "threads");
}

test("a matching feed rule replaces HUD copy and the row destination", async ({
  page,
}) => {
  await openLab(
    page,
    feed({
      threads: {
        label: "Thread History",
        description: "Open any past conversation with its full state.",
        destination: "memories",
      },
      learning: { label: "Learning", description: "Learn from every run." },
    }),
  );
  await expect(
    row(page, "threads").locator("[data-cpk-hud-action]"),
  ).toHaveText("Thread History");
  await expect(
    row(page, "learning").locator("[data-cpk-hud-action]"),
  ).toHaveText("Learning");
  await expectTooltip(
    page,
    "threads",
    "Open any past conversation with its full state.",
  );
  await screenshot(page, "hud-remote");
  await row(page, "threads").locator("[data-cpk-hud-action]").click();
  await expect(
    page.locator('button[data-inspector-menu-key][aria-current="page"]'),
  ).toHaveAttribute("data-inspector-menu-key", "memories");
});

test("the longest allowed copy stays inside the HUD", async ({ page }) => {
  await openLab(
    page,
    feed({
      threads: { label: LONGEST_LABEL, description: LONGEST_DESCRIPTION },
      learning: { label: "Automatic Learning for every run" },
    }),
  );
  expect([LONGEST_LABEL.length, LONGEST_DESCRIPTION.length]).toEqual([32, 140]);
  await expectTooltip(page, "threads", LONGEST_DESCRIPTION);
  const hudBox = await page.locator("[data-cpk-launcher-hud]").boundingBox();
  for (const id of ["threads", "learning"]) {
    const box = await row(page, id).boundingBox();
    expect(hudBox && box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(hudBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      hudBox!.x + hudBox!.width + 0.5,
    );
    const label = row(page, id).locator(".cpk-launcher-hud__label");
    expect(
      await label.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    const labelBox = await label.boundingBox();
    const help = await row(page, id)
      .locator("[data-cpk-hud-learn-more]")
      .boundingBox();
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(help!.x);
    const toggle = await row(page, id)
      .locator("[data-cpk-hud-toggle]")
      .boundingBox();
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(
      hudBox!.x + hudBox!.width + 0.5,
    );
  }
  const tooltip = await row(page, "threads").getByRole("tooltip").boundingBox();
  const viewport = page.viewportSize();
  expect(tooltip!.x).toBeGreaterThanOrEqual(0);
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(viewport!.width);
  await screenshot(page, "hud-longest-copy");
});

const fallbacks: [string, FeedResponse][] = [
  ["the request fails", { status: 404, body: "" }],
  ["the feed is not JSON", { contentType: "application/json", body: "{" }],
  [
    "no rule matches the SDK version",
    feed({ threads: { label: "Thread History" } }, ">=2.0.0"),
  ],
  [
    "the destination is unknown",
    feed({ threads: { destination: "thread-replay" } }),
  ],
];

for (const [name, response] of fallbacks) {
  test(`the HUD keeps its built-in content when ${name}`, async ({ page }) => {
    await openLab(page, response);
    if (response.status === 404) await screenshot(page, "hud-default");
    await expectBuiltInContent(page);
  });
}
