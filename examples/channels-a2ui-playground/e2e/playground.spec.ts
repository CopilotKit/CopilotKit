import { expect, test } from "@playwright/test";

test("shows the intermediate Channels UI for the rendered input", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("Example", { exact: true })
    .selectOption("basic-text-button");
  const intermediate = page.getByRole("region", {
    name: "Intermediate Channels UI",
    exact: true,
  });
  await expect(intermediate).toBeVisible();
  const tree = intermediate.locator("pre");
  const initialTree = JSON.parse(await tree.innerText());
  expect(initialTree.map((node: { type: string }) => node.type)).toEqual([
    "header",
    "actions",
  ]);
  const button = initialTree[1].props.children[0];
  expect(button.type).toBe("button");
  expect(button.props.onClick.id).toBe("a2ui|basic|button|retry");

  await page.getByText("Generated Block Kit JSON", { exact: true }).click();
  const blocks = page
    .getByLabel("Generated Block Kit JSON", { exact: true })
    .locator("pre");
  const initialBlocks = JSON.parse(await blocks.innerText());
  expect(initialBlocks[1].elements[0].action_id).toBe(button.props.onClick.id);

  const editor = page.getByRole("textbox", { name: "A2UI JSON" });
  const input = JSON.parse(await editor.inputValue());
  input.components.find(
    (component: { id: string }) => component.id === "title",
  ).text = "Updated status";
  await editor.fill(JSON.stringify(input));
  await expect(tree).toContainText("Status ready");
  await expect(tree).not.toContainText("Updated status");
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(tree).toContainText("Updated status");
  await expect(blocks).toContainText("Updated status");

  await page.screenshot({
    path: testInfo.outputPath("intermediate-channels-ui.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(intermediate).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: testInfo.outputPath("intermediate-channels-ui-mobile.png"),
    fullPage: true,
  });

  await editor.fill("{broken");
  await page.getByRole("button", { name: "Render preview" }).click();
  await expect(tree).toHaveText("[]");
  await expect(blocks).toHaveText("[]");
  await page
    .getByLabel("Example", { exact: true })
    .selectOption("market-snapshot");
  await expect(tree).toContainText("Live energy market snapshot");
});

test("renders Retry and logs its edited data-bound action", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByLabel("Example", { exact: true })
    .selectOption("basic-text-button");
  const preview = page.getByRole("region", { name: "Slack preview" });
  await expect(
    preview.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();

  const editor = page.getByRole("textbox", { name: "A2UI JSON" });
  const input = JSON.parse(await editor.inputValue());
  input.data.service = "billing";
  await editor.fill(JSON.stringify(input));
  await page.getByRole("button", { name: "Render preview" }).click();
  await preview.getByRole("button", { name: "Retry", exact: true }).click();

  const log = page.getByRole("region", { name: "Action log" });
  await expect(log).toContainText('"name": "retry"');
  await expect(log).toContainText('"service": "billing"');
  await expect(log).toContainText("direct click");
  await preview.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(log.getByRole("listitem")).toHaveCount(2);
  await expect(log.getByRole("listitem").first()).toContainText(
    '"service": "billing"',
  );
  await expect(log.getByRole("listitem").first()).toContainText(
    "renderer simulate",
  );
  await page.screenshot({
    path: testInfo.outputPath("text-and-button.png"),
    fullPage: true,
  });
});

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
