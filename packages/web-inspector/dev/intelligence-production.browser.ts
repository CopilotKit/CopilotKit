import { expect, test } from "@playwright/test";

const url =
  "/?scenario=pro-enabled-existing&reset=1&intelligenceMode=production&intelligenceAppUrl=https%3A%2F%2Fintelligence.example%2Finspector.html";

test("production grants filter navigation and revocation removes the whole surface", async ({
  page,
}) => {
  let permitted = true;
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Embedded product view</title>",
    }),
  );
  await page.route("**/inspector-intelligence", (route) =>
    route.fulfill({
      status: permitted ? 200 : 403,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        agents: ["support", "billing"],
        grant: {
          permissions: {
            "analytics.numbers": { agents: ["support"] },
            "conversations.text": { agents: "*" },
          },
        },
      }),
    }),
  );
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 10_000,
  });
  const inspector = page.locator("cpk-web-inspector");

  await expect(inspector.locator("[data-inspector-menu-key]")).toHaveCount(1);
  await expect(
    inspector.locator('[data-inspector-menu-key="analytics"]'),
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Web Inspector", exact: true })
    .press("Enter");
  await expect(
    inspector.locator('[data-inspector-menu-key="analytics"]'),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  const frame = inspector.locator('iframe[title="Analytics"]');
  await expect(frame).toHaveAttribute("src", /agentId=support/);
  await frame.evaluate((element) =>
    element.setAttribute("data-route-preserved", "yes"),
  );
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith("/inspector-intelligence"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(frame).toHaveAttribute("data-route-preserved", "yes");
  permitted = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    inspector.locator("iframe, .console-button, .inspector-window"),
  ).toHaveCount(0);
});

test("production stays hidden without a grant", async ({ page }) => {
  await page.route("**/inspector-intelligence", (route) =>
    route.fulfill({ status: 403, body: "{}", contentType: "application/json" }),
  );
  const denied = page.waitForResponse((response) =>
    response.url().endsWith("/inspector-intelligence"),
  );
  await page.goto(url);
  const response = await denied;
  expect(response.status()).toBe(403);
  await page
    .getByRole("button", { name: "Open Inspector", exact: true })
    .click();
  await expect(
    page
      .locator("cpk-web-inspector")
      .locator("iframe, .console-button, .inspector-window"),
  ).toHaveCount(0);
});

test("production preserves development state and never opens development data subscriptions", async ({
  page,
}) => {
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/(?:threads|inspector-learning)(?:[/?]|$)/u.test(request.url()))
      legacyRequests.push(request.url());
  });
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Product view</title>",
    }),
  );
  await page.route("**/inspector-intelligence", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        agents: ["support"],
        grant: {
          permissions: {
            "analytics.numbers": { agents: "*" },
            "governance.record": { agents: "*" },
            "learning.insights_skills": { agents: "*" },
          },
        },
      }),
    }),
  );
  await page.goto(url);
  const inspector = page.locator("cpk-web-inspector");
  await expect(inspector.locator("[data-inspector-menu-key]")).toHaveCount(3);
  await page.evaluate(() =>
    localStorage.setItem("cpk:inspector:state", "development-state-sentinel"),
  );
  await inspector.locator('[data-inspector-menu-key="memories"]').click();
  await expect(inspector.locator('iframe[title="Learning"]')).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await inspector
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await expect(
    inspector.getByRole("button", { name: "Web Inspector", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("cpk:inspector:state")),
  ).toBe("development-state-sentinel");
  expect(legacyRequests).toEqual([]);
});

test("a Learning-only agent grant opens Learning without developer controls or another agent", async ({
  page,
}) => {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Learning</title>",
    }),
  );
  await page.route("**/inspector-intelligence", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        agents: ["support", "billing"],
        grant: {
          permissions: { "learning.insights_skills": { agents: ["support"] } },
        },
      }),
    }),
  );
  await page.goto(url);
  const inspector = page.locator("cpk-web-inspector");
  await expect(inspector.locator("[data-inspector-menu-key]")).toHaveCount(1);
  await expect(
    inspector.locator('[data-inspector-menu-key="memories"]'),
  ).toBeVisible();
  await expect(inspector.locator('iframe[title="Learning"]')).toHaveAttribute(
    "src",
    /agentId=support/,
  );
  await expect(
    inspector.getByRole("button", { name: "Workbench", exact: true }),
  ).toHaveCount(0);
  await inspector.getByRole("button", { name: /Select agent scope:/ }).click();
  await expect(
    inspector.getByRole("button", { name: "billing", exact: true }),
  ).toHaveCount(0);
});

test("a mounted Inspector can enter product-only mode and return to its development tools", async ({
  page,
}) => {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Product view</title>",
    }),
  );
  await page.goto(url.replace("&intelligenceMode=production", ""));
  const inspector = page.locator("cpk-web-inspector");
  await expect(
    inspector.locator('[data-inspector-menu-key="threads"]'),
  ).toBeVisible();
  await inspector.evaluate((element) => {
    (element as HTMLElement & { intelligenceOnly: boolean }).intelligenceOnly =
      true;
  });
  await expect(inspector.locator("[data-inspector-menu-key]")).toHaveCount(3);
  await expect(
    inspector.locator('[data-inspector-menu-key="threads"]'),
  ).toHaveCount(0);
  await expect(inspector.locator('iframe[title="Analytics"]')).toBeVisible();
  await inspector.evaluate((element) => {
    (element as HTMLElement & { intelligenceOnly: boolean }).intelligenceOnly =
      false;
  });
  await inspector.locator('[data-inspector-menu-key="threads"]').click();
  await inspector
    .getByRole("button", { name: /Inspector launch review/ })
    .click();
  await expect(
    inspector.getByText("This response came from the local scenario lab.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    inspector.locator('[data-inspector-menu-key="playground"]'),
  ).toBeVisible();
});
