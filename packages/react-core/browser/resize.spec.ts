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

function sandboxFrame(page: Page) {
  const sandbox = page.frames().find((frame) => frame !== page.mainFrame());
  if (!sandbox) throw new Error("Sandbox frame missing");
  return sandbox;
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
}

// A feedback loop reports every few frames forever, so a settled frame is one
// whose height and report count stay unchanged over a quiet window of frames.
async function settled(page: Page, maxReports: number) {
  await sandboxFrame(page).waitForFunction(() => "__ckResizeWatch" in window);
  await ticks(page, 40);
  const reports = await reportCount(page);
  const height = await frameHeight(page);
  await ticks(page, 24);
  expect(await reportCount(page)).toBe(reports);
  expect(await frameHeight(page)).toBe(height);
  expect(reports).toBeLessThanOrEqual(maxReports);
  return height;
}

// Content that never fits must stay reachable: the document either fits the
// frame up to the default 16px of body margins or scrolls.
async function expectReachable(page: Page) {
  const doc = await sandboxFrame(page).evaluate(() => ({
    overflow: getComputedStyle(document.documentElement).overflowY,
    hidden: document.documentElement.scrollHeight - innerHeight,
  }));
  if (doc.hidden > 16) expect(doc.overflow).toBe("auto");
  else expect(doc.overflow).toBe("hidden");
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
    name: "an element JS sizes to innerHeight in a padded body",
    html: `<style>body { padding: 16px }</style><div id="fill"></div><script>
      function fill() { document.getElementById("fill").style.height = innerHeight + "px"; }
      fill();
      addEventListener("resize", fill);
    </script>`,
    maxReports: 3,
    maxHeight: 424,
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
    await expectReachable(page);
  });
}

test("ordinary content gets its exact height", async ({ page }) => {
  await render(page, '<div style="height: 600px"></div>');
  await expect.poll(() => frameHeight(page)).toBe(616);
  expect(await settled(page, 1)).toBe(616);
  await expectReachable(page);
});

// Frame height minus the height the content needs: the bottom of #text plus
// the default 8px bottom body margin.
const fitGap = async (page: Page) =>
  (await frameHeight(page)) -
  (await sandboxFrame(page).evaluate(() =>
    Math.ceil(
      document.getElementById("text")!.getBoundingClientRect().bottom + 8,
    ),
  ));

test("ordinary content follows growth, shrink and a narrower host", async ({
  page,
}) => {
  // HTML and generating: false arrive in one render, before the sandbox exists.
  const html = `<div id="box" style="height: 300px"></div>
    <p id="text" style="margin: 0; font: 16px/20px sans-serif">${"word ".repeat(120)}</p>`;
  const grow = 'document.getElementById("box").style.height = "500px"';
  const shrink = 'document.getElementById("box").style.height = "100px"';
  await render(page, html);
  await expect.poll(() => fitGap(page)).toBe(0);
  const initial = await frameHeight(page);

  await render(page, html, [grow]);
  await expect.poll(() => fitGap(page)).toBe(0);
  const grown = await frameHeight(page);
  expect(grown).toBeGreaterThan(initial);

  await render(page, html, [grow, shrink]);
  await expect.poll(() => fitGap(page)).toBe(0);
  const shrunk = await frameHeight(page);
  expect(shrunk).toBeLessThan(grown);

  await page.evaluate(() => {
    document.getElementById("root")!.style.width = "240px";
  });
  await expect.poll(() => fitGap(page)).toBe(0);
  expect(await frameHeight(page)).toBeGreaterThan(shrunk);
  await settled(page, 4);
  await expectReachable(page);
});

test("content added inside a full-height body is followed", async ({
  page,
}) => {
  const html =
    '<style>html, body { height: 100% }</style><div id="list"><div style="height: 50px"></div></div>';
  await render(page, html);
  await settled(page, 1);
  await render(page, html, [
    'const row = document.createElement("div"); row.style.height = "600px"; document.getElementById("list").appendChild(row)',
  ]);
  await expect.poll(() => frameHeight(page)).toBe(666);
  await settled(page, 2);
  await expectReachable(page);
  // The measurement's height override is gone: the body is 100% of the frame.
  expect(
    await sandboxFrame(page).evaluate(
      () => innerHeight - document.body.getBoundingClientRect().height,
    ),
  ).toBe(0);
});

test("a stopped page neither grows nor stops scrolling when its text changes", async ({
  page,
}) => {
  const html =
    '<div style="min-height: 100vh; padding: 20px"><span id="clock">1</span></div>';
  await render(page, html);
  await settled(page, 3);
  await expectReachable(page);
  await render(page, html, [
    'document.getElementById("clock").textContent = "2"',
  ]);
  await expect(sandboxFrame(page).locator("#clock")).toHaveText("2");
  await settled(page, 3);
  await expectReachable(page);
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
  await expectReachable(page);
});
