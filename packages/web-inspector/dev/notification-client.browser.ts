import { expect, test } from "@playwright/test";

test("workbench only simulates the client and preserves unknown versions in links", async ({
  page,
}) => {
  await page.goto("/?scenario=oss-intelligence-disabled&sdk-version=1.70.2");
  await expect(page.locator("body")).toHaveAttribute("data-lab-ready", "true");
  await expect(
    page.getByRole("link", { name: "Notifications", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#notification-custom-text")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Web Inspector", exact: true })
    .click();
  await page.locator("#sdk-version").fill("");
  await expect(page).toHaveURL(/sdk-version=(&|$)/);
  await page
    .getByRole("button", { name: "Replay notification", exact: true })
    .click();
  await expect(page.locator("#sdk-version")).toHaveValue("");
  await expect(page.locator("body")).toHaveAttribute("data-lab-ready", "true");
  await expect(page.locator("cpk-web-inspector")).toHaveJSProperty(
    "notificationContext",
    { development: true, framework: "react", sdkVersion: "" },
  );
  await page.locator("#sdk-framework").selectOption("angular");
  await expect(page.locator("cpk-web-inspector")).toHaveJSProperty(
    "notificationContext",
    { development: true, framework: "angular", sdkVersion: "" },
  );
  await page.screenshot({
    path: ".inspector-workbench/private-authoring-pivot/workbench.png",
  });
});
