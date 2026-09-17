import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const artifacts = resolve(
  "../../.inspector-workbench/thread-conversation-reader",
);

test("capture the equivalent diagnostic baseline", async ({ page }) => {
  await mkdir(artifacts, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/conversation-reader.html?view=timeline");
    await expect(
      page.getByRole("tab", { name: "Messages", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cpk-td__timeline-item").first()).toBeVisible();
    await page.screenshot({
      path: resolve(artifacts, `reader-before-${width}.png`),
    });
  }
});

test("conversation stays readable with accessible diagnostics at desktop and mobile widths", async ({
  page,
}) => {
  await mkdir(artifacts, { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/conversation-reader.html");
    await expect(
      page.getByRole("tab", { name: "Conversation", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("Can I continue with the cart I saved yesterday?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Read-only conversation", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cpk-conversation-message")).toHaveCount(6);
    await page.screenshot({
      path: resolve(artifacts, `reader-after-${width}.png`),
    });
    const call = page.getByText("Tool call: restore_cart", { exact: true });
    await call.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText('"cartId": "cart-42"', { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Conversation", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("tab", { name: "State", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("tabpanel", { name: "State", exact: true })
        .getByText("checkoutStep", { exact: false }),
    ).toBeVisible();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("tab", { name: "Conversation", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(call.locator("..")).toHaveAttribute("open", "");
    expect(
      await page
        .locator("body")
        .evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
