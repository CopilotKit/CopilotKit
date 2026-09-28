import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Opens the real Inspector with a simple product document to track iframe state. */
async function setup(page: Page, production = false) {
  await page.route("https://intelligence.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><title>Product view</title><label>Question<input aria-label="Question"></label>',
    }),
  );
  await page.goto(
    `/?scenario=pro-enabled-existing&reset=1&intelligenceAppUrl=https%3A%2F%2Fintelligence.example%2Finspector.html${production ? "&intelligenceMode=production" : ""}`,
  );
  await page.locator('[data-inspector-menu-key="analytics"]').click();
  return page.frameLocator('iframe[title="Analytics"]');
}

/** Checks rendered bounds after resize without relying on animation timing. */
async function expectWindowFits(page: Page) {
  await expect
    .poll(async () =>
      page.locator(".inspector-window").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  const close = page.getByRole("button", {
    name: "Close Web Inspector",
    exact: true,
  });
  await expect(close).toBeInViewport({ ratio: 1 });
}

test("phone and landscape layouts keep the window controls and embedded pane within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const frame = await setup(page);
  await expectWindowFits(page);
  await expect(page.locator(".inspector-sidebar")).toHaveCSS("width", "52px");
  await frame
    .getByRole("textbox", { name: "Question" })
    .fill("Keep this draft");
  await page.setViewportSize({ width: 844, height: 390 });
  await expectWindowFits(page);
  await expect(frame.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Keep this draft",
  );
  await page
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Web Inspector", exact: true })
    .press("Enter");
  await expectWindowFits(page);
});

test("shrinking and expanding the viewport preserves the iframe and restores desktop navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const frame = await setup(page);
  await expectWindowFits(page);
  await expect(page.locator(".inspector-sidebar")).toHaveCSS("width", "224px");
  await frame.getByRole("textbox", { name: "Question" }).fill("Resize safely");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectWindowFits(page);
  await expect(page.locator(".inspector-sidebar")).toHaveCSS("width", "52px");
  await expect(frame.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Resize safely",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectWindowFits(page);
  await expect(page.locator(".inspector-sidebar")).toHaveCSS("width", "224px");
  await expect(frame.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Resize safely",
  );
});

test("docked and production windows also fit phone widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator("body").evaluate((body) => {
    body.style.marginLeft = "17px";
  });
  const originalMargin = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).marginLeft);
  await page
    .getByRole("button", { name: "Window layout", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Dock/ }).click();
  await expect(page.locator(".inspector-window")).toHaveAttribute(
    "data-docked",
    "true",
  );
  await expectWindowFits(page);
  await expect(page.locator(".inspector-window")).toHaveCSS("width", "390px");
  await expect(page.locator("body")).toHaveCSS("margin-left", "390px");
  await page.setViewportSize({ width: 768, height: 844 });
  await expectWindowFits(page);
  await expect(page.locator("body")).toHaveCSS("margin-left", "640px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectWindowFits(page);
  await expect(page.locator("body")).toHaveCSS("margin-left", "390px");
  await page
    .getByRole("button", { name: "Window layout", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /Float/ }).click();
  await expectWindowFits(page);
  await expect(page.locator("body")).toHaveCSS("margin-left", originalMargin);
  await setup(page, true);
  await expectWindowFits(page);
  await page.locator('[data-inspector-menu-key="memories"]').click();
  await expect(page.locator('iframe[title="Learning"]')).toBeInViewport({
    ratio: 1,
  });
});
