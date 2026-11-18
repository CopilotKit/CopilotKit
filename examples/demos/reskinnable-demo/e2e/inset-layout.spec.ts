import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The inset panel layout — the shell's outer geometry.
 *
 * Covers only what needs a real browser: panel order, resize bounds, persistence
 * across a reload and across a skin switch, and the collapse/restore cycles. None
 * of it is observable in jsdom, which has no layout engine — every sizing bug this
 * layout shipped (a thread rail collapsed to zero width, a rail that could not be
 * reopened, an assistant column that could be widened but never narrowed) passed a
 * green unit suite.
 *
 * CI-safe: sends no chat message and clicks no suggestion, so it needs no OpenAI
 * key and never invokes the agent.
 */

/**
 * Navigate and wait for the frame to actually be laid out.
 *
 * The shell is client-rendered, so the panels do not exist at `goto` resolution —
 * reading geometry straight after it returns an empty set.
 */
async function gotoSkin(page: Page, skin: string) {
  await page.goto(`/${skin}`);
  await expect(page.getByTestId("shell-frame")).toBeVisible();
  await expect(page.getByTestId("app-panel")).toBeVisible();
}

/** The frame's only separator is the gutter between the assistant and the app. */
function gutter(page: Page) {
  return page.getByRole("separator");
}

/** Panel ids double as their emitted data-testid, so this reads the live order. */
async function panelOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator("[data-testid='shell-frame'] [data-testid$='-panel']")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
}

async function widthOf(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  return Math.round(box?.width ?? 0);
}

/** Drive the gutter from the keyboard: it is role=separator and focusable, which
 *  is far steadier than a synthetic mouse drag. */
async function nudgeGutter(
  page: Page,
  key: "ArrowRight" | "ArrowLeft",
  times: number,
) {
  await gutter(page).focus();
  for (let i = 0; i < times; i += 1) await page.keyboard.press(key);
  // Let the group settle before measuring.
  await page.waitForTimeout(300);
}

test.describe("inset panel layout", () => {
  test("renders the assistant before the app by default", async ({ page }) => {
    await gotoSkin(page, "banking");

    expect(await panelOrder(page)).toEqual(["sidebar-panel", "app-panel"]);
    await expect(page.getByTestId("skin-selector")).toBeVisible();
    await expect(page.getByTestId("chat-panel-header")).toBeVisible();
  });

  test("swapping sides reverses the panels and survives a reload", async ({
    page,
  }) => {
    await gotoSkin(page, "banking");
    await page.getByTestId("swap-sides").click();

    await expect
      .poll(() => panelOrder(page))
      .toEqual(["app-panel", "sidebar-panel"]);

    await page.reload();
    await expect
      .poll(() => panelOrder(page))
      .toEqual(["app-panel", "sidebar-panel"]);
  });

  test("the assistant resizes in both directions and never swallows the app", async ({
    page,
  }) => {
    await gotoSkin(page, "banking");
    const start = await widthOf(page, "sidebar-panel");

    // Widening used to be unbounded: with no ceiling the only limit was the app's
    // own floor, so the assistant could reach ~75% of the frame.
    await nudgeGutter(page, "ArrowRight", 60);
    const widened = await widthOf(page, "sidebar-panel");
    const appAtWidest = await widthOf(page, "app-panel");
    expect(widened).toBeGreaterThan(start);
    expect(appAtWidest).toBeGreaterThanOrEqual(widened);

    // Narrowing below the starting width is the part that regressed twice.
    await nudgeGutter(page, "ArrowLeft", 120);
    const narrowed = await widthOf(page, "sidebar-panel");
    expect(narrowed).toBeLessThan(start);
    expect(await widthOf(page, "app-panel")).toBeGreaterThan(appAtWidest);
  });

  test("the thread rail collapses AND reopens from the header toggle", async ({
    page,
  }) => {
    await gotoSkin(page, "banking");
    const rail = page.locator(".nw-chat-rail");
    await expect(rail).toBeVisible();
    const openWidth = await rail
      .boundingBox()
      .then((b) => Math.round(b?.width ?? 0));

    await page.getByTestId("chat-inbox-toggle").click();
    await expect(rail).toHaveCount(0);

    // Reopening is the assertion that matters: the rail was once unreopenable,
    // because the panel API restored its "most recent size" of zero.
    await page.getByTestId("chat-inbox-toggle").click();
    await expect(rail).toBeVisible();
    expect(
      await rail.boundingBox().then((b) => Math.round(b?.width ?? 0)),
    ).toBe(openWidth);
  });

  test("hiding collapses the selector with the chat, and the launcher restores both", async ({
    page,
  }) => {
    await gotoSkin(page, "banking");
    await expect(page.getByTestId("skin-selector")).toBeVisible();

    await page.getByTestId("sidebar-close").click();

    // The selector and the chat are ONE logical sidebar: hiding takes both.
    await expect(page.getByTestId("skin-selector")).toHaveCount(0);
    await expect(page.getByTestId("chat-panel-header")).toHaveCount(0);
    await expect(page.getByTestId("app-panel")).toBeVisible();
    await expect(page.getByTestId("sidebar-launcher")).toBeVisible();

    await page.getByTestId("sidebar-launcher").click();
    await expect(page.getByTestId("skin-selector")).toBeVisible();
    await expect(page.getByTestId("chat-panel-header")).toBeVisible();
  });

  test("the selector lists skins only while open", async ({ page }) => {
    await gotoSkin(page, "banking");

    // A dropdown rather than a pill row so its footprint stays flat as skins are
    // added — which means the options must not exist until it opens.
    await expect(page.locator("[data-testid^='skin-option-']")).toHaveCount(0);
    await expect(page.getByTestId("skin-selector-trigger")).toContainText(
      "Northwind Finance",
    );

    await page.getByTestId("skin-selector-trigger").click();
    await expect(page.getByTestId("skin-option-banking")).toBeVisible();
    await expect(page.getByTestId("skin-option-airline")).toBeVisible();
    await expect(page.getByTestId("skin-option-logistics")).toBeVisible();
    await expect(page.getByTestId("skin-option-keel")).toBeVisible();
  });

  test("the layout persists across a skin switch", async ({ page }) => {
    await gotoSkin(page, "banking");
    await page.getByTestId("swap-sides").click();
    await expect
      .poll(() => panelOrder(page))
      .toEqual(["app-panel", "sidebar-panel"]);

    await page.getByTestId("skin-selector-trigger").click();
    await page.getByTestId("skin-option-airline").click();
    await expect(page).toHaveURL(/\/airline$/);

    // Preferences are shell-global, not per-skin — switching skins must not
    // rearrange the workspace mid-demo.
    await expect
      .poll(() => panelOrder(page))
      .toEqual(["app-panel", "sidebar-panel"]);
    await expect(page.getByTestId("skin-selector-trigger")).toContainText(
      "Aeronova",
    );
  });

  test("each skin's chrome fits its card without scrolling the document", async ({
    page,
  }) => {
    for (const skin of ["banking", "airline", "logistics", "keel"]) {
      await gotoSkin(page, skin);

      // Skin layouts root at h-full so they fill the app card. A viewport-height
      // root overflows it by the frame's padding and scrolls the whole document,
      // taking the skin's pinned nav with it.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(overflow, `${skin} overflows the app card`).toBeLessThanOrEqual(0);
    }
  });

  test("the chat header shows the active skin's assistant name", async ({
    page,
  }) => {
    // Regression guard: as CopilotSidebar's header slot this read the chat's own
    // configuration provider; as a sibling of the inline chat it read the
    // wrapper's, whose default "CopilotKit Chat" won the ?? chain and replaced
    // every skin's assistant name.
    await gotoSkin(page, "banking");
    await expect(page.getByTestId("chat-panel-header")).toContainText(
      "Northwind Copilot",
    );

    await gotoSkin(page, "keel");
    await expect(page.getByTestId("chat-panel-header")).not.toContainText(
      "CopilotKit Chat",
    );
  });
});
