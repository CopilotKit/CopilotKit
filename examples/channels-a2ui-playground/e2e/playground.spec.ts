import { expect, test } from "@playwright/test";

test("reports a rendered button with an unmapped action ID", async ({
  page,
}) => {
  await page.goto("/");
  const preview = page.getByRole("region", { name: "Slack preview" });
  const button = preview.getByRole("button", {
    name: "Acknowledge",
    exact: true,
  });
  await button.evaluate((element) => {
    element.id = "unmapped-action";
  });
  await button.click();
  const log = page.getByRole("region", { name: "Action log" });
  await expect(log).toContainText("No A2UI action handler");
  await expect(log).not.toContainText("acknowledge_search_result");
});

test("renders the market snapshot and logs both real and simulated A2UI actions", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const preview = page.getByRole("region", { name: "Slack preview" });
  await expect(preview).toContainText("Live energy market snapshot");
  await expect(preview).toContainText("Brent crude");
  await expect(preview.getByRole("table")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("playground.png"),
    fullPage: true,
  });

  const log = page.getByRole("region", { name: "Action log" });
  await preview
    .getByRole("button", { name: "Acknowledge", exact: true })
    .click();
  await expect(log).toContainText("acknowledge_search_result");
  await expect(log).toContainText("root");
  await page.getByRole("button", { name: "Clear action log" }).click();
  await expect(log).not.toContainText("acknowledge_search_result");
  await preview.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(log).toContainText("acknowledge_search_result");
  expect(errors).toEqual([]);
});

test("reports malformed and unsupported input, then recovers with edited A2UI", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "A2UI JSON" });
  const fixture = JSON.parse(await editor.inputValue());
  await editor.fill("{broken");
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(
    page.getByRole("region", { name: "Slack preview" }),
  ).not.toContainText("Live energy market snapshot");
  const diagnostics = page.getByRole("region", {
    name: "Conversion diagnostics",
  });
  await expect(diagnostics.getByText(/invalid json/i)).toBeVisible();

  await editor.fill(
    JSON.stringify({
      surfaceId: "unsupported",
      components: [{ id: "root", component: "UnknownWidget" }],
    }),
  );
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(
    diagnostics.getByText(/unsupported.*UnknownWidget/i),
  ).toBeVisible();

  fixture.components[0].headline = "Edited market snapshot";
  await editor.fill(JSON.stringify(fixture));
  await editor.press("Control+Enter");
  await expect(
    page.getByRole("region", { name: "Slack preview" }),
  ).toContainText("Edited market snapshot");
  await page.getByLabel("Preview theme").selectOption("dark");
  await expect(
    page.locator('.slack_blocks_to_jsx.styles_enabled[data-theme="dark"]'),
  ).toBeVisible();
});
