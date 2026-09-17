import { test, expect } from "@playwright/test";

// Run against shell-docs, separately from the showcase application suite:
// DOCS_ONBOARDING_URL=http://localhost:3052 pnpm exec playwright test __tests__/e2e/docs-onboarding.spec.ts
const docsUrl = process.env.DOCS_ONBOARDING_URL;
test.skip(!docsUrl, "Requires a running shell-docs server");

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`the real preview advances and stops at eight seconds (${reducedMotion})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion });
    await page.goto(docsUrl!);
    const video = page.getByLabel("Eight-second silent Intelligence preview");
    await video.scrollIntoViewIfNeeded();
    if (reducedMotion === "reduce") {
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBe(0);
      await page.getByRole("button", { name: "Play 8-second preview" }).click();
    }
    await expect
      .poll(
        () =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);
    await page.screenshot({
      path: testInfo.outputPath(`preview-playing-${reducedMotion}.png`),
    });
    await expect(
      page.getByRole("button", { name: "Replay 8-second preview" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true);
    const stopped = await video.evaluate(
      (element: HTMLVideoElement) => element.currentTime,
    );
    expect(stopped).toBeGreaterThanOrEqual(8);
    expect(stopped).toBeLessThan(8.6);
    await page.getByRole("button", { name: "Replay 8-second preview" }).click();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.2);
    await page.getByRole("button", { name: "Pause preview" }).click();
    const paused = await video.evaluate(
      (element: HTMLVideoElement) => element.currentTime,
    );
    await page
      .getByRole("heading", { name: /Bring your agent/ })
      .first()
      .scrollIntoViewIfNeeded();
    await video.scrollIntoViewIfNeeded();
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true);
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.currentTime),
    ).toBeCloseTo(paused, 1);
  });
}

for (const width of [320, 390, 1280]) {
  test(`docs introduction and preview controls at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(docsUrl!);
    const preview = page.getByLabel("Eight-second silent Intelligence preview");
    await preview.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const play = await page
      .getByRole("button", { name: "Play 8-second preview" })
      .boundingBox();
    const full = await page
      .getByRole("button", { name: "Watch full walkthrough" })
      .boundingBox();
    expect(
      play!.x + play!.width <= full!.x || play!.y + play!.height <= full!.y,
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`docs-preview-${width}.png`),
    });
    await page
      .getByRole("heading", {
        name: "Add Intelligence when your agent meets real users",
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`docs-capabilities-${width}.png`),
    });
    const markdown = await request.get(`${docsUrl}/introduction.md`);
    expect(markdown.ok()).toBe(true);
    expect(await markdown.text()).toContain(
      "Self-Improving Agents & Product Learning",
    );
  });
}

test("the Rich Threads sidebar label opens its overview", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(docsUrl!);
  const threads = page
    .locator("#nd-sidebar")
    .getByRole("link", { name: "Rich Threads", exact: true })
    .first();
  await expect(threads).toBeVisible();
  await threads.click();
  await expect(page).toHaveURL(/\/threads$/);
  await expect(
    page.getByRole("heading", { name: "Rich Threads", exact: true }),
  ).toBeVisible();
});

test("the capability explanation leads to an interactive Dojo example", async ({
  page,
}, testInfo) => {
  await page.goto(docsUrl!);
  const demos = page
    .locator("#intelligence")
    .getByRole("link", { name: "Explore interactive demos" });
  await expect(demos).toHaveAttribute(
    "href",
    "https://dojo.showcase.copilotkit.ai/?integration=langgraph-python&demo=beautiful-chat",
  );
  await demos.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("docs-contextual-dojo.png"),
  });
  await demos.click();
  await expect(page).toHaveURL(
    "https://dojo.showcase.copilotkit.ai/?integration=langgraph-python&demo=beautiful-chat",
  );
  await expect(page).toHaveTitle("CopilotKit Interactive Dojo");
  await expect(
    page.getByText("CopilotKit Interactive Dojo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("LangGraph (Python)", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main iframe")).toHaveAttribute(
    "src",
    /langgraph-python.*\/demos\/beautiful-chat$/,
  );
  await expect(
    page
      .frameLocator("main iframe")
      .getByText("How can I help you today?", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.screenshot({
    path: testInfo.outputPath("docs-dojo-destination.png"),
  });
});
