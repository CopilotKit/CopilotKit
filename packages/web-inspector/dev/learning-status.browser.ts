import { expect, test } from "@playwright/test";
import { learningSnapshotForState } from "./learning-state-fixtures.js";

for (const origin of [
  "http://cpk.localhost:7066",
  "http://localhost:7066",
  "https://dashboard.example.com",
]) {
  test(`retries unavailable Learning and shows configured links on ${origin}`, async ({
    page,
  }) => {
    let recovered = false;
    const snapshot = learningSnapshotForState("empty-results");
    const configured = {
      ...snapshot,
      webAppOrigin: origin,
      links: {
        learning: `${origin}/o/acme/checkout/learning/checkout-assistant-default`,
        candidates: null,
        runs: null,
      },
    };
    await page.route(
      "**/inspector-learning-lab/data-error/inspector-learning?*",
      async (route) => {
        await route.fulfill({
          status: recovered ? 200 : 503,
          json: recovered ? configured : { error: "Unavailable" },
        });
      },
    );
    await page.goto("/?scenario=learning-data-error&reset=1");
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await page
      .getByRole("button", { name: "Close Web Inspector", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Web Inspector", exact: true })
      .click();
    const learning = page.locator('[data-inspector-service="memory"]');
    await expect(learning).toContainText("Learning status unavailable");
    await expect(
      page.locator(
        '[data-feature-state-group="available"] [data-inspector-service="memory"]',
      ),
    ).toHaveCount(0);
    recovered = true;
    await page
      .getByRole("button", { name: "Retry Learning status", exact: true })
      .click();
    await expect(learning).toContainText("Learning configured");
    await expect(learning).toHaveAttribute("data-state", "on");
    await page
      .getByRole("button", { name: "Automatic Learning", exact: true })
      .click();
    await expect(page.locator("cpk-learning-view .quiet-link")).toHaveAttribute(
      "href",
      configured.links.learning,
    );
  });
}
