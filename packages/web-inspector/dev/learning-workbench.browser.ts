import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { LEARNING_WORKBENCH_SCENARIOS } from "./learning-state-fixtures.js";

async function openWorkbenchState(
  page: Page,
  state: (typeof LEARNING_WORKBENCH_SCENARIOS)[number]["state"],
): Promise<void> {
  await page.goto(`/?scenario=learning-${state}&reset=1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
}

test("enumerates and navigates the complete Automatic Learning matrix at the root", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1702, height: 1200 });
  const infoResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/inspector-learning-lab/landing/info") &&
      response.request().method() === "GET",
  );
  await openWorkbenchState(page, "landing");

  await expect(
    page.getByRole("heading", { name: "Inspector state workbench" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Scenario validation console" }),
  ).toBeVisible();

  const options = page.locator(
    '#scenario-select optgroup[label="Automatic Learning"] option',
  );
  await expect(options).toHaveCount(LEARNING_WORKBENCH_SCENARIOS.length);
  expect(
    await options.evaluateAll((items) =>
      items.map((item) => ({
        value: (item as HTMLOptionElement).value,
        label: item.textContent,
      })),
    ),
  ).toEqual(
    LEARNING_WORKBENCH_SCENARIOS.map(({ key, label }) => ({
      value: key,
      label: `Automatic Learning · ${label}`,
    })),
  );

  expect(await (await infoResponse).json()).toMatchObject({
    mode: "intelligence",
    inspectorLearning: true,
    agents: { "Checkout Assistant": { name: "Checkout Assistant" } },
  });
  await expect(
    page.getByRole("heading", {
      name: "Turn every interaction into reusable context.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy setup prompt for Threads" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-inspector-locked-feature-talk="memory"]'),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="CopilotKit Learning overview"]'),
  ).toBeVisible();

  await page.locator("#scenario-select").click();
  await page.locator("#scenario-select").press("Escape");
  await page.locator("#scenario-select").selectOption("learning-success");
  await page.waitForURL(/\?scenario=learning-success&reset=1$/);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("region", { name: "Skills in registry" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "verify-refund-request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "1 Skill for review in web app" }),
  ).toHaveAttribute(
    "href",
    "https://app.copilotkit.ai/o/acme/checkout/learning/checkout-assistant-default/skills",
  );
  await expect(
    page.getByText("Supporting Insight", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not applicable to Learning fixtures."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("guides an unavailable Threads runtime through setup instead of showing a dead end", async ({
  page,
}) => {
  await openWorkbenchState(page, "landing");
  await page.getByRole("button", { name: "Threads", exact: true }).click();

  await expect(
    page.getByRole("heading", {
      name: "Production-grade chat threads without the complexity. Self hostable.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Threads are unavailable.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy setup prompt for Threads" }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="Rich Threads overview"]'),
  ).toBeVisible();
});

test("selects every Automatic Learning state without editing the root URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1702, height: 1200 });
  await openWorkbenchState(page, "landing");
  const inspectorWindow = page.locator(".inspector-window");
  await expect(inspectorWindow).toHaveCSS("width", "960px");
  await expect(inspectorWindow).toHaveCSS("height", "740px");

  for (const { key, state } of LEARNING_WORKBENCH_SCENARIOS.slice(1)) {
    await page.locator("#scenario-select").selectOption(key);
    await page.waitForURL(`**/?scenario=${key}&reset=1`);
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    await expect(page.locator("body")).toHaveAttribute("data-scenario", key);
    await expect(page.locator("body")).toHaveAttribute(
      "data-learning-state",
      state,
    );
    await expect(inspectorWindow).toHaveCSS("width", "960px");
    await expect(inspectorWindow).toHaveCSS("height", "740px");
  }
});

test("provides a dedicated post-copy Learning setup state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1702, height: 1200 });
  await openWorkbenchState(page, "setup-pending");

  const setup = page.getByRole("region", { name: "Set up Learning" });
  await expect(setup.getByText("1 of 3 steps")).toBeVisible();
  await expect(setup.locator("#learning-setup-title")).toBeVisible();
  await expect(
    setup.getByRole("heading", { name: "Waiting for Learning setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy setup prompt for Threads" }),
  ).toHaveCount(0);
});

test("renders the Learning setup flow in dark mode", async ({ page }) => {
  await openWorkbenchState(page, "setup-pending");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();

  const learning = page.locator('cpk-learning-view[data-color-scheme="dark"]');
  await expect(learning).toBeVisible();
  await expect(learning).toHaveCSS("background-color", "rgb(21, 23, 30)");
  await expect(learning.locator(".setup-card")).toHaveCSS(
    "background-color",
    "rgb(29, 32, 41)",
  );
  await expect(learning.locator(".step.complete")).toHaveCSS(
    "background-color",
    "rgb(23, 41, 35)",
  );
});

test("keeps the copied Learning setup state after a root workbench reload", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:5177",
  });
  await openWorkbenchState(page, "landing");
  await page
    .getByRole("button", { name: "Copy setup prompt for Threads" })
    .click();

  const setup = page.getByRole("region", { name: "Set up Learning" });
  await expect(
    setup.getByRole("heading", { name: "Copy the setup prompt" }),
  ).toBeVisible();
  await expect(
    setup
      .locator(".step")
      .nth(1)
      .getByRole("heading", { name: "Set up Learning" }),
  ).toBeVisible();
  await expect(setup.locator(".step").first()).toHaveClass(/complete/);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("region", { name: "Set up Learning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Copy the setup prompt" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Set up Learning" })
      .locator(".step")
      .first(),
  ).toHaveClass(/complete/);
  await expect(
    page.getByRole("button", { name: "Copy setup prompt for Threads" }),
  ).toHaveCount(0);
});

test("renders the narrow root workbench with an icon rail and stacked setup steps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1200 });
  await openWorkbenchState(page, "no-threads");

  const inspectorWindow = page.locator(".inspector-window");
  const inspectorBox = await inspectorWindow.boundingBox();
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox!.x).toBe(0);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(768);
  await expect(
    page.locator('.inspector-sidebar[data-icon-rail="true"]'),
  ).toBeVisible();
  const setup = page.getByRole("region", { name: "Set up Learning" });
  await expect(setup.getByText("1 of 3 steps")).toBeVisible();
  await expect(
    setup.getByRole("heading", { name: "Waiting for the first Thread" }),
  ).toBeVisible();
  const stepBoxes = await setup.locator(".step").evaluateAll((steps) =>
    steps.map((step) => {
      const bounds = step.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y };
    }),
  );
  expect(stepBoxes).toHaveLength(3);
  expect(new Set(stepBoxes.map(({ x }) => Math.round(x))).size).toBe(1);
  expect(stepBoxes[1]!.y).toBeGreaterThan(stepBoxes[0]!.y);
  expect(stepBoxes[2]!.y).toBeGreaterThan(stepBoxes[1]!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Close Web Inspector" }).click();
  await expect(page.locator("#scenario-select")).toBeVisible();
  await page.locator("#scenario-select").selectOption("learning-success");
  await page.waitForURL(/\?scenario=learning-success&reset=1$/);
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("region", { name: "Skills in registry" }),
  ).toBeVisible();
});
