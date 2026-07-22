import axe from "axe-core";
import { chromium, devices, firefox, webkit } from "playwright";
import type { BrowserType, Locator, Page } from "playwright";

export type FrontendBrowserEngine = "chromium" | "firefox" | "webkit";

export interface FrontendBrowserProject {
  id: string;
  engine: FrontendBrowserEngine;
  kind: "desktop" | "device-emulation";
  viewport?: { width: number; height: number };
  device?: "Pixel 7" | "iPhone 13";
}

export const FRONTEND_BROWSER_PROJECTS = [
  {
    id: "chromium-desktop",
    engine: "chromium",
    kind: "desktop",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "firefox-desktop",
    engine: "firefox",
    kind: "desktop",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "webkit-desktop",
    engine: "webkit",
    kind: "desktop",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "chromium-mobile-emulation",
    engine: "chromium",
    kind: "device-emulation",
    device: "Pixel 7",
  },
  {
    id: "webkit-mobile-emulation",
    engine: "webkit",
    kind: "device-emulation",
    device: "iPhone 13",
  },
] as const satisfies readonly FrontendBrowserProject[];

export const FRONTEND_BROWSER_STATES = [
  { id: "chat-ready", feature: "agentic-chat" },
  { id: "popup-open", feature: "prebuilt-popup" },
  {
    id: "popup-closed-focus-restored",
    feature: "prebuilt-popup",
  },
  { id: "sidebar-open", feature: "prebuilt-sidebar" },
] as const;

export type FrontendBrowserStateId =
  (typeof FRONTEND_BROWSER_STATES)[number]["id"];

export const ACCESSIBILITY_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21aa",
  "wcag22aa",
] as const;

/** Look up a declared project without accepting browser marketing aliases. */
export function browserProjectById(id: string): FrontendBrowserProject {
  const project = FRONTEND_BROWSER_PROJECTS.find(
    (candidate) => candidate.id === id,
  );
  if (!project) throw new Error(`unknown browser project ${id}`);
  return project;
}

export interface AccessibilityViolationSummary {
  id: string;
  impact: string | null;
  nodeCount: number;
}

type AssertionStatus = "passed" | "failed" | "not-applicable";

export type BrowserErrorKind =
  | "angular-injection-context"
  | "angular-missing-provider"
  | "angular-required-input"
  | "angular-expression-changed"
  | "angular-zone-required"
  | "interaction-timeout"
  | "network-resource"
  | "browser-closed"
  | "popup-responsive"
  | "reduced-motion"
  | "reduced-motion-emulation"
  | "unclassified";

/** Reduce browser failures to a closed, privacy-safe diagnostic vocabulary. */
export function classifyBrowserError(value: string): BrowserErrorKind {
  if (value.includes("NG0203")) return "angular-injection-context";
  if (value.includes("NullInjectorError")) return "angular-missing-provider";
  if (value.includes("NG0950")) return "angular-required-input";
  if (value.includes("NG0100")) return "angular-expression-changed";
  if (value.includes("NG0908")) return "angular-zone-required";
  if (/Timeout|waiting for (?:locator|selector)/i.test(value)) {
    return "interaction-timeout";
  }
  if (/Failed to load resource|net::ERR_/i.test(value)) {
    return "network-resource";
  }
  if (/page, context or browser has been closed/i.test(value)) {
    return "browser-closed";
  }
  if (
    /popup geometry is unavailable|mobile popup is not full-screen|desktop popup unexpectedly fills the viewport/i.test(
      value,
    )
  ) {
    return "popup-responsive";
  }
  if (/reduced-motion preference is unavailable/i.test(value)) {
    return "reduced-motion-emulation";
  }
  if (/reduced-motion (?:popup|sidebar) still animates/i.test(value)) {
    return "reduced-motion";
  }
  return "unclassified";
}

export interface FrontendBrowserStateResult {
  stateId: FrontendBrowserStateId;
  status: "passed" | "failed";
  durationMs: number;
  violations: AccessibilityViolationSummary[];
  assertions: {
    keyboard: AssertionStatus;
    focus: AssertionStatus;
    responsive: AssertionStatus;
    securityHeaders: AssertionStatus;
  };
  diagnostics: FrontendSurfaceDiagnostics;
  failureStage?: string;
  failureKind?: BrowserErrorKind;
}

export interface FrontendSurfaceDiagnostics {
  featurePage: boolean;
  unavailablePage: boolean;
  copilotChat: boolean;
  textareaAttached: boolean;
  textareaVisible: boolean;
  popupToggle: boolean;
  dialogAttached: boolean;
  dialogVisible: boolean;
  sidebarToggle: boolean;
  sidebarAttached: boolean;
  sidebarVisible: boolean;
  pageErrorCount: number;
  consoleErrorCount: number;
  consoleErrorKinds: BrowserErrorKind[];
  pageErrorKinds: BrowserErrorKind[];
}

export interface FrontendBrowserArtifact {
  schemaVersion: 1;
  commitSha: string;
  project: FrontendBrowserProject;
  startedAt: string;
  finishedAt: string;
  summary: { total: number; passed: number; failed: number };
  states: FrontendBrowserStateResult[];
}

/** Shape the privacy-safe browser evidence artifact. */
export function createFrontendBrowserArtifact(input: {
  commitSha: string;
  project: FrontendBrowserProject;
  startedAt: string;
  finishedAt: string;
  results: FrontendBrowserStateResult[];
}): FrontendBrowserArtifact {
  const failed = input.results.filter(
    (result) => result.status === "failed",
  ).length;
  return {
    schemaVersion: 1,
    commitSha: input.commitSha,
    project: input.project,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    summary: {
      total: input.results.length,
      passed: input.results.length - failed,
      failed,
    },
    states: input.results,
  };
}

function browserType(engine: FrontendBrowserEngine): BrowserType {
  if (engine === "chromium") return chromium;
  if (engine === "firefox") return firefox;
  return webkit;
}

function contextOptions(
  project: FrontendBrowserProject,
): Record<string, unknown> {
  const base = {
    colorScheme: "light" as const,
    reducedMotion: "reduce" as const,
    extraHTTPHeaders: {
      "X-AIMock-Strict": "true",
      "X-AIMock-Context": "langgraph-python",
      "X-Test-Id": `browser-${project.id}`,
    },
  };
  if (project.device) return { ...devices[project.device], ...base };
  return { ...base, viewport: project.viewport };
}

function assertSecurityHeaders(headers: Record<string, string>): void {
  const csp = headers["content-security-policy"] ?? "";
  if (!csp.includes("frame-ancestors") || !csp.includes("object-src 'none'")) {
    throw new Error("content security policy is incomplete");
  }
  if (headers["x-content-type-options"] !== "nosniff") {
    throw new Error("x-content-type-options is incomplete");
  }
  if (headers["referrer-policy"] !== "no-referrer") {
    throw new Error("referrer policy is incomplete");
  }
  if (!headers["permissions-policy"]) {
    throw new Error("permissions policy is missing");
  }
}

/** Execute Axe without inserting a CSP-blocked inline script element. */
export async function runAxe(
  page: Page,
): Promise<AccessibilityViolationSummary[]> {
  await page.evaluate(axe.source);
  const expression = `
    globalThis.axe.run(globalThis.document, {
      runOnly: { type: "tag", values: ${JSON.stringify(ACCESSIBILITY_TAGS)} }
    }).then((result) => result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodeCount: violation.nodes.length
    })))
  `;
  return (await page.evaluate(expression)) as AccessibilityViolationSummary[];
}

/** Wait for asynchronous render hooks to place focus within a surface. */
export async function waitForFocusWithin(
  page: Page,
  selector: string,
): Promise<void> {
  await page.waitForFunction(
    `(function () {
      var owner = document.querySelector(${JSON.stringify(selector)});
      return Boolean(owner && owner.contains(document.activeElement));
    })()`,
  );
}

/** Apply and verify the media precondition used by motion assertions. */
export async function ensureReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(
    'matchMedia("(prefers-reduced-motion: reduce)").matches',
  );
  if (!reduced) throw new Error("reduced-motion preference is unavailable");
}

/** Read the effective animation name using Locator's executable callback API. */
export async function animationNameFor(locator: Locator): Promise<string> {
  return locator.evaluate(
    (element) =>
      element.ownerDocument.defaultView?.getComputedStyle(element)
        .animationName ?? "none",
  );
}

async function diagnoseSurface(
  page: Page,
  errorCounts: {
    page: number;
    console: number;
    pageKinds: BrowserErrorKind[];
    consoleKinds: BrowserErrorKind[];
  },
): Promise<FrontendSurfaceDiagnostics> {
  const attached = async (selector: string): Promise<boolean> =>
    (await page.locator(selector).count()) > 0;
  const visible = async (selector: string): Promise<boolean> =>
    page.locator(selector).first().isVisible();
  return {
    featurePage: await attached(".feature-page"),
    unavailablePage: await attached("showcase-unavailable-feature"),
    copilotChat: await attached("copilot-chat"),
    textareaAttached: await attached("textarea, [role='textbox']"),
    textareaVisible: await visible("textarea, [role='textbox']"),
    popupToggle: await attached("[data-copilot-popup-toggle]"),
    dialogAttached: await attached('[role="dialog"]'),
    dialogVisible: await visible('[role="dialog"]'),
    sidebarToggle: await attached("[data-copilot-sidebar-toggle]"),
    sidebarAttached: await attached("[data-copilot-sidebar]"),
    sidebarVisible: await visible("[data-copilot-sidebar]"),
    pageErrorCount: errorCounts.page,
    consoleErrorCount: errorCounts.console,
    consoleErrorKinds: [...new Set(errorCounts.consoleKinds)].sort(),
    pageErrorKinds: [...new Set(errorCounts.pageKinds)].sort(),
  };
}

async function assertPopup(
  page: Page,
  project: FrontendBrowserProject,
  close: boolean,
): Promise<Omit<FrontendBrowserStateResult["assertions"], "securityHeaders">> {
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible" });
  await waitForFocusWithin(page, '[role="dialog"]');

  if (close) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    const restored = await page.evaluate(
      `document.activeElement === document.querySelector('[data-copilot-popup-toggle]')`,
    );
    if (!restored) throw new Error("popup launcher focus was not restored");
    return {
      keyboard: "passed",
      focus: "passed",
      responsive: "not-applicable",
    };
  }

  await page.keyboard.press("Tab");
  await waitForFocusWithin(page, '[role="dialog"]');
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("popup geometry is unavailable");
  if (project.kind === "device-emulation") {
    if (
      Math.abs(box.width - viewport.width) > 1 ||
      Math.abs(box.height - viewport.height) > 1
    ) {
      throw new Error("mobile popup is not full-screen");
    }
  } else if (box.width >= viewport.width || box.height >= viewport.height) {
    throw new Error("desktop popup unexpectedly fills the viewport");
  }
  await ensureReducedMotion(page);
  const animationName = await animationNameFor(dialog);
  if (animationName !== "none") {
    throw new Error("reduced-motion popup still animates");
  }
  return { keyboard: "passed", focus: "passed", responsive: "passed" };
}

async function assertSidebar(
  page: Page,
  project: FrontendBrowserProject,
): Promise<Omit<FrontendBrowserStateResult["assertions"], "securityHeaders">> {
  const sidebar = page.locator("[data-copilot-sidebar]");
  await sidebar.waitFor({ state: "visible" });
  const role = await sidebar.getAttribute("role");
  if (project.kind === "device-emulation") {
    if (
      role !== "dialog" ||
      (await sidebar.getAttribute("aria-modal")) !== "true"
    ) {
      throw new Error("mobile sidebar is not modal");
    }
    await waitForFocusWithin(page, "[data-copilot-sidebar]");
    await page.keyboard.press("Tab");
    await waitForFocusWithin(page, "[data-copilot-sidebar]");
    const box = await sidebar.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport || Math.abs(box.width - viewport.width) > 1) {
      throw new Error("mobile sidebar is not full-width");
    }
  } else if (role !== "complementary") {
    throw new Error("desktop sidebar is not a complementary landmark");
  }
  await ensureReducedMotion(page);
  const animationName = await animationNameFor(sidebar);
  if (animationName !== "none") {
    throw new Error("reduced-motion sidebar still animates");
  }
  return {
    keyboard: project.kind === "device-emulation" ? "passed" : "not-applicable",
    focus: project.kind === "device-emulation" ? "passed" : "not-applicable",
    responsive: "passed",
  };
}

async function runState(
  page: Page,
  baseUrl: string,
  project: FrontendBrowserProject,
  state: (typeof FRONTEND_BROWSER_STATES)[number],
): Promise<FrontendBrowserStateResult> {
  const startedAt = Date.now();
  const errorCounts: {
    page: number;
    console: number;
    pageKinds: BrowserErrorKind[];
    consoleKinds: BrowserErrorKind[];
  } = { page: 0, console: 0, pageKinds: [], consoleKinds: [] };
  page.on("pageerror", (error) => {
    errorCounts.page += 1;
    errorCounts.pageKinds.push(classifyBrowserError(error.message));
  });
  page.on("console", (entry) => {
    if (entry.type() === "error") {
      errorCounts.console += 1;
      errorCounts.consoleKinds.push(classifyBrowserError(entry.text()));
    }
  });
  const assertions: FrontendBrowserStateResult["assertions"] = {
    keyboard: "not-applicable",
    focus: "not-applicable",
    responsive: "not-applicable",
    securityHeaders: "failed",
  };
  let failureStage = "navigation";
  try {
    const response = await page.goto(
      `${baseUrl.replace(/\/$/, "")}/langgraph-python/${state.feature}`,
      { waitUntil: "load" },
    );
    if (!response?.ok()) throw new Error("browser state navigation failed");
    assertSecurityHeaders(response.headers());
    assertions.securityHeaders = "passed";
    await page.waitForSelector("[ng-version]", { state: "attached" });

    failureStage = "interaction";
    if (state.id === "chat-ready") {
      const composer = page.locator("textarea, [role='textbox']").first();
      await composer.waitFor({ state: "visible" });
      await composer.focus();
      await waitForFocusWithin(page, "textarea, [role='textbox']");
      assertions.keyboard = "passed";
      assertions.focus = "passed";
      assertions.responsive = "passed";
    } else if (state.id === "popup-open") {
      Object.assign(assertions, await assertPopup(page, project, false));
    } else if (state.id === "popup-closed-focus-restored") {
      Object.assign(assertions, await assertPopup(page, project, true));
    } else {
      Object.assign(assertions, await assertSidebar(page, project));
    }

    failureStage = "axe";
    const violations = await runAxe(page);
    return {
      stateId: state.id,
      status: violations.length === 0 ? "passed" : "failed",
      durationMs: Date.now() - startedAt,
      violations,
      assertions,
      diagnostics: await diagnoseSurface(page, errorCounts),
      ...(violations.length > 0 ? { failureStage } : {}),
    };
  } catch (error) {
    return {
      stateId: state.id,
      status: "failed",
      durationMs: Date.now() - startedAt,
      violations: [],
      assertions,
      diagnostics: await diagnoseSurface(page, errorCounts),
      failureStage,
      failureKind: classifyBrowserError(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

/** Run the reusable UI, responsive, security-header, and Axe state suite. */
export async function runFrontendBrowserSuite(input: {
  project: FrontendBrowserProject;
  baseUrl: string;
  commitSha: string;
}): Promise<FrontendBrowserArtifact> {
  const startedAt = new Date().toISOString();
  const browser = await browserType(input.project.engine).launch({
    headless: true,
  });
  try {
    const context = await browser.newContext(contextOptions(input.project));
    const results: FrontendBrowserStateResult[] = [];
    try {
      for (const state of FRONTEND_BROWSER_STATES) {
        const page = await context.newPage();
        try {
          results.push(
            await runState(page, input.baseUrl, input.project, state),
          );
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
    return createFrontendBrowserArtifact({
      commitSha: input.commitSha,
      project: input.project,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
    });
  } finally {
    await browser.close();
  }
}
