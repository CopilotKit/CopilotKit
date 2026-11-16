import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Keep renders deterministic: the page may only talk to the dev server.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  await page.goto("/visual/tool-calls");
});

const toolCall = (page: Page, status: string) =>
  page.getByTestId("wildcard-tool-render").filter({ hasText: status });

test("transcript", async ({ page }) => {
  const transcript = page.getByTestId("visual-tool-calls");
  await expect(page.getByTestId("wildcard-tool-render")).toHaveCount(2);
  await expect(transcript).toHaveScreenshot("transcript.png");
});

for (const status of ["Running", "Complete"] as const) {
  test(`tool call ${status.toLowerCase()}`, async ({ page }) => {
    const call = toolCall(page, status);
    // The status icon and the wrench icon must both draw something.
    const icons = call.locator("svg.copilot-tool-icon");
    await expect(icons).toHaveCount(2);
    for (const icon of await icons.all()) {
      await expect(icon.locator("path, circle, line").first()).toBeAttached();
    }
    await expect(call).toHaveScreenshot(
      `tool-call-${status.toLowerCase()}.png`,
    );
  });
}

test("tool call complete, expanded", async ({ page }) => {
  const call = toolCall(page, "Complete");
  await call.getByRole("button").click();
  await expect(call.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(call).toHaveScreenshot("tool-call-complete-expanded.png");
});
