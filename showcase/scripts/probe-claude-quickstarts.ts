import { chromium } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

const BASE_URL = process.env.PREVIEW_URL ?? "http://localhost:3003";

type FrameworkProbe = {
  slug: "claude-sdk-python" | "claude-sdk-typescript";
  starterPanelText: string;
  byoaText: string;
};

const FRAMEWORKS: FrameworkProbe[] = [
  {
    slug: "claude-sdk-python",
    starterPanelText:
      "npx copilotkit@latest init --framework claude-sdk-python",
    byoaText: "Expose Claude Agent SDK over AG-UI",
  },
  {
    slug: "claude-sdk-typescript",
    starterPanelText:
      "npx copilotkit@latest init --framework claude-sdk-typescript",
    byoaText: "Expose Claude Agent SDK over AG-UI",
  },
];

const VIEWPORTS = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function pageUrl(slug: string, query = ""): string {
  return `${BASE_URL.replace(/\/$/, "")}/${slug}/quickstart${query}`;
}

async function assertVisibleText(page: Page, text: string): Promise<void> {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: 10_000 });
}

async function assertSelectedTab(page: Page, name: RegExp): Promise<void> {
  const tab = page.getByRole("tab", { name }).first();
  await tab.waitFor({ state: "visible", timeout: 10_000 });
  const selected = await tab.getAttribute("aria-selected");
  if (selected !== "true") {
    throw new Error(`expected ${name} tab to be selected, got ${selected}`);
  }
}

async function assertNoHorizontalDocumentOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  if (overflow > 4) {
    throw new Error(`document has ${overflow}px horizontal overflow`);
  }
}

async function assertCodeBlocksUsable(page: Page): Promise<void> {
  const codeBlockCount = await page.locator("pre").evaluateAll(
    (blocks) =>
      blocks.filter((block) => {
        const rect = block.getBoundingClientRect();
        const style = window.getComputedStyle(block);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }).length,
  );
  if (codeBlockCount < 4) {
    throw new Error(
      `expected at least 4 visible code blocks, found ${codeBlockCount}`,
    );
  }

  const copyButtons = page.locator(
    'button[aria-label*="Copy" i], button:has-text("Copy")',
  );
  const copyButtonCount = await copyButtons.evaluateAll(
    (buttons) =>
      buttons.filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }).length,
  );
  if (copyButtonCount < codeBlockCount) {
    throw new Error(
      `expected at least one visible copy button per visible code block, found ${copyButtonCount} copy buttons for ${codeBlockCount} code blocks`,
    );
  }
}

async function focusTabByKeyboard(page: Page, name: RegExp): Promise<void> {
  const tab = page.getByRole("tab", { name }).first();
  await tab.waitFor({ state: "visible", timeout: 10_000 });
  const expectedId = await tab.getAttribute("id");
  if (!expectedId) {
    throw new Error(`tab ${name} does not have an id for focus verification`);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.keyboard.press("Tab");
    const activeId = await page.evaluate(
      () => document.activeElement?.id ?? "",
    );
    if (activeId === expectedId) return;
  }

  throw new Error(`tab ${name} was not reachable with keyboard Tab`);
}

async function collectConsoleErrors<T>(
  page: Page,
  fn: () => Promise<T>,
): Promise<T> {
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  };
  const onPageError = (error: Error) => errors.push(error.message);

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {
    const result = await fn();
    if (errors.length > 0) {
      throw new Error(`browser errors:\n${errors.join("\n")}`);
    }
    return result;
  } catch (err) {
    // Surface captured console/page errors alongside the failure — when fn()
    // rejects (e.g. a Playwright assertion), those messages are usually the
    // most useful signal for why. Guard against double-appending when the
    // success path above already threw a "browser errors:" error.
    const base = err instanceof Error ? err.message : String(err);
    if (errors.length > 0 && !base.startsWith("browser errors:")) {
      throw new Error(`${base}\nbrowser errors:\n${errors.join("\n")}`, {
        cause: err,
      });
    }
    throw err;
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

async function probeFramework(page: Page, framework: FrameworkProbe) {
  await page.goto(pageUrl(framework.slug), { waitUntil: "networkidle" });
  await assertVisibleText(page, "Choose your starting point");
  await assertSelectedTab(page, /Start from scratch/i);
  await assertVisibleText(page, framework.starterPanelText);
  await assertCodeBlocksUsable(page);
  await assertNoHorizontalDocumentOverflow(page);
  await page.getByRole("tab", { name: /Start from scratch/i }).waitFor();
  await page.getByRole("tab", { name: /Use an existing agent/i }).waitFor();

  await page.getByRole("tab", { name: /Use an existing agent/i }).click();
  await page.waitForURL(/agent=bring-your-own/);
  await assertSelectedTab(page, /Use an existing agent/i);
  await assertVisibleText(page, framework.byoaText);

  await page.reload({ waitUntil: "networkidle" });
  await assertSelectedTab(page, /Use an existing agent/i);
  await assertVisibleText(page, framework.byoaText);

  await page.goto(pageUrl(framework.slug, "?agent=unknown"), {
    waitUntil: "networkidle",
  });
  await assertSelectedTab(page, /Start from scratch/i);
  await assertVisibleText(page, framework.starterPanelText);
  await assertCodeBlocksUsable(page);
  await assertNoHorizontalDocumentOverflow(page);

  await focusTabByKeyboard(page, /Start from scratch/i);
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/agent=bring-your-own/);
  await assertSelectedTab(page, /Use an existing agent/i);
  await assertVisibleText(page, framework.byoaText);

  await page.goBack({ waitUntil: "networkidle" });
  await assertSelectedTab(page, /Start from scratch/i);
  await assertVisibleText(page, framework.starterPanelText);
  await page.goForward({ waitUntil: "networkidle" });
  await assertSelectedTab(page, /Use an existing agent/i);
  await assertVisibleText(page, framework.byoaText);

  await assertVisibleText(page, "Backend tools and state");
  await assertVisibleText(page, "Bridge Claude Agent SDK to AG-UI");
  await assertCodeBlocksUsable(page);
  await assertNoHorizontalDocumentOverflow(page);
}

async function main() {
  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport });
      for (const framework of FRAMEWORKS) {
        try {
          await collectConsoleErrors(page, () =>
            probeFramework(page, framework),
          );
          console.log(`[PASS] ${framework.slug} ${viewport.name}`);
        } catch (error) {
          failures.push(
            `[FAIL] ${framework.slug} ${viewport.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
