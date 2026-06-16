import type { Page } from "@playwright/test";

const RUNTIME_READY_TIMEOUT = 15_000;

function waitForRuntimeResponse(page: Page) {
  return page.waitForResponse(
    (response) => {
      const pathname = new URL(response.url()).pathname;

      return (
        pathname.includes("/api/copilotkit") &&
        response.status() >= 200 &&
        response.status() < 300
      );
    },
    { timeout: RUNTIME_READY_TIMEOUT },
  );
}

export async function gotoDemoAndWaitForRuntime(page: Page, path: string) {
  const runtimeReady = waitForRuntimeResponse(page);

  await page.goto(path);
  await runtimeReady;
}

export async function actAndWaitForRuntime(
  page: Page,
  action: () => Promise<unknown>,
) {
  const runtimeReady = waitForRuntimeResponse(page);
  await action();
  await runtimeReady;
}

export async function waitForCopilotIdle(page: Page, timeout = 30_000) {
  await page
    .locator('[data-copilot-running="false"]')
    .first()
    .waitFor({ state: "visible", timeout });
}
