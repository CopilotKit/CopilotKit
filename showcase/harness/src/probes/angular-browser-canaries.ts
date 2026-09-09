interface PageErrorSource {
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  off(event: "pageerror", listener: (error: Error) => void): unknown;
}

interface RuntimeReadinessPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: "domcontentloaded" },
  ): Promise<unknown>;
}

/** Run a browser check and report each uncaught error with its useful detail. */
export async function assertNoAngularPageErrors(
  page: PageErrorSource,
  run: () => Promise<void>,
): Promise<void> {
  const pageErrors: string[] = [];
  const listener = (error: Error): void => {
    pageErrors.push(`${error.name}: ${error.message}`);
  };
  page.on("pageerror", listener);
  try {
    await run();
    if (pageErrors.length > 0) {
      throw new Error(
        `browser page raised ${pageErrors.length} uncaught error(s): ${pageErrors.join("; ")}`,
      );
    }
  } finally {
    page.off("pageerror", listener);
  }
}

/** Navigate a cold, throttled page without using the shorter UI wait limit. */
export async function navigateForRuntimeReadiness(
  page: RuntimeReadinessPage,
  url: string,
): Promise<void> {
  await page.goto(url, {
    timeout: 30_000,
    waitUntil: "domcontentloaded",
  });
}
