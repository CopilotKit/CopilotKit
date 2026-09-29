import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Model the licensed Intelligence thread-list contract while chat uses local fixtures.
// Live validation separately covers actual project entitlements and persisted threads.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/copilotkit/info", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), licenseStatus: "valid" },
    });
  });
  await page.route("**/api/copilotkit/threads?*", (route) =>
    route.fulfill({ json: { threads: [] } }),
  );
});

test("chat streams a reply, continues, and starts a separate conversation", async ({
  page,
}) => {
  const threadIds: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/agent/default/run")) {
      const body = request.postDataJSON();
      threadIds.push(body.threadId);
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("copilot-threads-drawer")).toBeVisible();
  await expect(page.getByRole("img", { name: "CopilotKit" })).toHaveCount(0);
  await page.getByRole("textbox").fill("Hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Hello! This is a local mock response from the starter.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("Continue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("This is the second response in the same conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New Conversation", exact: true })
    .click();
  await expect(
    page.getByText("How can I help you today?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("Fresh start");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Hello! This is a local mock response from the starter.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(threadIds).toHaveLength(3);
  expect(threadIds[0]).toBe(threadIds[1]);
  expect(threadIds[2]).not.toBe(threadIds[0]);
});

for (const width of [390, 1280]) {
  test(`Beautiful Chat is accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(
      page.getByText("How can I help you today?", { exact: true }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/beautiful-chat-${width}.png`,
      fullPage: true,
    });
  });
}
