import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

type HarnessWindow = Window & {
  renderContent: (content: object) => void;
  resizeReports: number[];
};

const frameHeight = (page: Page) =>
  page
    .locator("iframe")
    .evaluate((iframe) => iframe.getBoundingClientRect().height);

const reportCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as HarnessWindow).resizeReports.length,
  );

async function ticks(page: Page, count: number) {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        const tick = () =>
          --frames === 0 ? resolve() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      }),
    count,
  );
}

async function render(page: Page, html: string, jsExpressions?: string[]) {
  await page.evaluate(
    (content) => {
      (window as unknown as HarnessWindow).renderContent({
        html: [content.html],
        htmlComplete: true,
        cssComplete: true,
        generating: false,
        jsExpressions: content.jsExpressions,
      });
    },
    { html, jsExpressions },
  );
  await expect(page.locator("iframe")).toBeVisible();
  const sandbox = page.frames().find((frame) => frame !== page.mainFrame());
  if (!sandbox) throw new Error("Sandbox frame missing");
  await sandbox.waitForFunction(() => "__ckResizeWatch" in window);
}

// A feedback loop reports every few frames forever, so a settled frame is one
// whose height and report count stay unchanged over a quiet window of frames.
async function settled(page: Page, maxReports: number) {
  await ticks(page, 40);
  const reports = await reportCount(page);
  const height = await frameHeight(page);
  await ticks(page, 24);
  expect(await reportCount(page)).toBe(reports);
  expect(await frameHeight(page)).toBe(height);
  expect(reports).toBeLessThanOrEqual(maxReports);
  return height;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const host = window as unknown as HarnessWindow;
    host.resizeReports = [];
    window.addEventListener("message", (event) => {
      const iframe = document.querySelector("iframe");
      if (
        event.source === iframe?.contentWindow &&
        event.data?.type === "__ck_resize"
      ) {
        host.resizeReports.push(event.data.height);
      }
    });
  });
});

// Generated pages keep the default 8px body margins. Initial frame: 200px.
const viewportSized = [
  {
    name: "a min-height: 100vh hero",
    html: '<div style="min-height: 100vh">Hero</div>',
    maxReports: 0,
    maxHeight: 200,
  },
  {
    name: "an element JS sizes to innerHeight",
    html: `<div id="fill"></div><script>
      function fill() { document.getElementById("fill").style.height = innerHeight + "px"; }
      fill();
      addEventListener("resize", fill);
    </script>`,
    maxReports: 0,
    maxHeight: 200,
  },
  {
    name: "a padded 100vh hero",
    html: '<div style="min-height: 100vh; padding: 20px">Hero</div>',
    maxReports: 3,
    maxHeight: 424,
  },
  {
    name: "a header above a 100vh hero",
    html: '<header style="height: 40px"></header><div style="min-height: 100vh">Hero</div>',
    maxReports: 3,
    maxHeight: 424,
  },
  {
    name: "a 110vh block",
    html: '<div style="height: 110vh"></div>',
    maxReports: 3,
    maxHeight: 400,
  },
];

for (const { name, html, maxReports, maxHeight } of viewportSized) {
  test(`${name} settles without a resize loop`, async ({ page }) => {
    await render(page, html);
    expect(await settled(page, maxReports)).toBeLessThanOrEqual(maxHeight);
  });
}

test("ordinary content gets its exact height", async ({ page }) => {
  await render(page, '<div style="height: 600px"></div>');
  await expect.poll(() => frameHeight(page)).toBe(616);
  expect(await settled(page, 1)).toBe(616);
});

test("content that grows after the guard stops is still followed", async ({
  page,
}) => {
  const html =
    '<div style="min-height: 100vh; padding: 20px"><div id="rows" style="height: 40px"></div></div>';
  await render(page, html);
  await settled(page, 3);
  await render(page, html, [
    'document.getElementById("rows").style.height = "600px"',
  ]);
  await expect.poll(() => frameHeight(page)).toBeGreaterThanOrEqual(656);
  await settled(page, 8);
});
