import type { Page } from "playwright";

interface AngularFeatureSurfaceState {
  expectedCellPresent: boolean;
  unavailable: boolean;
  textareaPresent: boolean;
  textareaVisible: boolean;
}

interface BrowserDocument {
  body: { textContent: string | null };
  querySelector(selector: string): {
    getBoundingClientRect(): { width: number; height: number };
  } | null;
}

interface ViewportSize {
  width: number;
  height: number;
}

/** Read the exact feature markers from the browser document. */
function readSurfaceStateInBrowser(
  expectedCellId: string,
): AngularFeatureSurfaceState {
  const browserDocument = (
    globalThis as typeof globalThis & { document: BrowserDocument }
  ).document;
  const textarea = browserDocument.querySelector(
    '[data-testid="copilot-chat-textarea"]',
  );
  const bounds = textarea?.getBoundingClientRect();
  return {
    expectedCellPresent:
      browserDocument.body.textContent?.includes(expectedCellId) ?? false,
    unavailable:
      browserDocument.querySelector("showcase-unavailable-feature") !== null,
    textareaPresent: textarea !== null,
    textareaVisible:
      bounds !== undefined && bounds.width > 0 && bounds.height > 0,
  };
}

/** Return true once the lazy feature route has rendered a visible chat. */
function surfaceReadyInBrowser(expectedCellId: string): boolean {
  const browserDocument = (
    globalThis as typeof globalThis & { document: BrowserDocument }
  ).document;
  const textarea = browserDocument.querySelector(
    '[data-testid="copilot-chat-textarea"]',
  );
  const bounds = textarea?.getBoundingClientRect();
  return (
    (browserDocument.body.textContent?.includes(expectedCellId) ?? false) &&
    browserDocument.querySelector("showcase-unavailable-feature") === null &&
    textarea !== null &&
    bounds !== undefined &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

/** Wait for Angular's lazy route, then verify its real chat surface. */
export async function assertRunnableAngularFeatureSurface(
  page: Pick<Page, "evaluate" | "waitForFunction">,
  expectedCellId: string,
): Promise<void> {
  try {
    await page.waitForFunction(surfaceReadyInBrowser, expectedCellId);
  } catch {
    // Read the final state below so the error names the failed contract.
  }

  const state = await page.evaluate(readSurfaceStateInBrowser, expectedCellId);
  if (
    !state.expectedCellPresent ||
    state.unavailable ||
    !state.textareaPresent ||
    !state.textareaVisible
  ) {
    throw new Error(
      `Angular feature surface mismatch: cell=${state.expectedCellPresent}; unavailable=${state.unavailable}; textarea=${state.textareaPresent}; visible=${state.textareaVisible}`,
    );
  }
}

/** Return true once the animated mobile popup fills the target viewport. */
function mobilePopupFillsViewportInBrowser(viewport: ViewportSize): boolean {
  const browserDocument = (
    globalThis as typeof globalThis & { document: BrowserDocument }
  ).document;
  const dialog = browserDocument.querySelector(
    '[role="dialog"][aria-modal="true"]',
  );
  const bounds = dialog?.getBoundingClientRect();
  return (
    bounds !== undefined &&
    bounds.width >= viewport.width - 1 &&
    bounds.height >= viewport.height - 1
  );
}

/** Wait for the popup animation, then verify the final mobile layout. */
export async function assertMobilePopupFillsViewport(
  page: Pick<Page, "getByRole" | "waitForFunction">,
  viewport: ViewportSize,
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Copilot" });
  await dialog.waitFor();
  try {
    await page.waitForFunction(mobilePopupFillsViewportInBrowser, viewport);
  } catch {
    // Read the final box below so the error includes the measured size.
  }

  const box = await dialog.boundingBox();
  if (
    box === null ||
    box.width < viewport.width - 1 ||
    box.height < viewport.height - 1
  ) {
    throw new Error(
      `mobile popup does not fill the viewport: width=${box?.width ?? "missing"}; height=${box?.height ?? "missing"}`,
    );
  }
}
