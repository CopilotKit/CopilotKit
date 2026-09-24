import assert from "node:assert/strict";
import { after as afterAll, before as beforeAll, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
let browser;
let server;
let outdir;
let baseURL;

beforeAll(async () => {
  outdir = await mkdtemp(path.join(tmpdir(), "copilotkit-hidden-chat-"));
  await build({
    entryPoints: [path.join(here, "hidden-chat.fixture.tsx")],
    outdir,
    entryNames: "bundle",
    bundle: true,
    platform: "browser",
    format: "esm",
    loader: { ".ttf": "file", ".woff": "file", ".woff2": "file" },
    logLevel: "error",
  });
  await writeFile(
    path.join(outdir, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>',
  );
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = path.resolve(
      outdir,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(outdir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html";
      res.writeHead(200, { "content-type": type }).end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (outdir) await rm(outdir, { recursive: true, force: true });
});

async function openChat({ count, mode, nextCount = count }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.goto(
    `${baseURL}/?count=${count}&mode=${mode}&nextCount=${nextCount}`,
  );
  await page.locator('[data-testid="copilot-message-list"]').waitFor();
  await page.waitForFunction(() => {
    const content = document.querySelector(
      '[data-testid="copilot-scroll-content"]',
    );
    return (
      content &&
      [...content.closest("#host").querySelectorAll("div")].some(
        (el) => el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 500,
      )
    );
  });
  await page.evaluate(() => {
    const content = document.querySelector(
      '[data-testid="copilot-scroll-content"]',
    );
    const candidates = [];
    for (let el = content; el && el.id !== "host"; el = el.parentElement) {
      candidates.push(el);
    }
    window.__chatScroll = candidates.find(
      (el) =>
        /auto|scroll/.test(getComputedStyle(el).overflowY) &&
        el.clientHeight > 0 &&
        el.scrollHeight - el.clientHeight > 500,
    );
  });
  return page;
}

async function metrics(page) {
  return page.evaluate(() => {
    const el = window.__chatScroll;
    const rows = [...document.querySelectorAll("[data-index]")];
    return {
      scrollTop: el.scrollTop,
      fromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
      firstRow: rows.length ? Number(rows[0].getAttribute("data-index")) : null,
      lastRow: rows.length
        ? Number(rows.at(-1).getAttribute("data-index"))
        : null,
    };
  });
}

async function scrollAway(page) {
  // Let the initial smooth pin and measured virtual rows settle before the
  // intentional user scroll so startup motion cannot race the assertion.
  await page.waitForTimeout(900);
  await page.mouse.move(350, 260);
  await page.mouse.wheel(0, -7000);
  await page.waitForFunction(() => {
    const el = window.__chatScroll;
    return el.scrollHeight - el.clientHeight - el.scrollTop > 500;
  });
  await page.waitForTimeout(350);
  const before = await metrics(page);
  await page.locator("#rerender").click();
  await page.waitForTimeout(150);
  const after = await metrics(page);
  assert.ok(
    after.fromBottom > 500,
    `ordinary re-render must leave the reader up: ${JSON.stringify({ before, after })}`,
  );
  assert.ok(
    Math.abs(after.scrollTop - before.scrollTop) < 250,
    `ordinary re-render moved: ${JSON.stringify({ before, after })}`,
  );
  return after;
}

async function hideAndRestore(page) {
  await page.locator("#hide").click();
  await page.waitForFunction(
    () => document.querySelector("#host").clientHeight === 0,
  );
  await page.waitForTimeout(120);
  await page.locator("#rerender").click();
  await page.locator("#show").click();
  await page.waitForFunction(
    () => document.querySelector("#host").clientHeight > 0,
  );
  await page.locator("#rerender").click();
  await page.waitForTimeout(1100);
}

test("pin-to-bottom preserves a scrolled-up reader across host hiding without virtualization", async () => {
  const page = await openChat({ count: 20, mode: "pin-to-bottom" });
  try {
    const before = await scrollAway(page);
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom > 500,
      `reader moved to bottom: ${JSON.stringify({ before, after })}`,
    );
    assert.ok(Math.abs(after.scrollTop - before.scrollTop) < 250);
  } finally {
    await page.close();
  }
});

test("virtualization preserves a scrolled-up reader across host hiding without pinning", async () => {
  const page = await openChat({ count: 80, mode: "none" });
  try {
    await page.evaluate(() => {
      const el = window.__chatScroll;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    });
    const before = await scrollAway(page);
    assert.notEqual(before.firstRow, null);
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom > 500,
      `reader moved to bottom: ${JSON.stringify({ before, after })}`,
    );
    assert.ok(
      after.firstRow <= before.lastRow && after.lastRow >= before.firstRow,
      `visible message range changed: ${JSON.stringify({ before, after })}`,
    );
  } finally {
    await page.close();
  }
});

test("default chat preserves a scrolled-up reader across host hiding", async () => {
  const page = await openChat({ count: 80, mode: "pin-to-bottom" });
  try {
    const before = await scrollAway(page);
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom > 500,
      `reader moved to bottom: ${JSON.stringify({ before, after })}`,
    );
    assert.ok(
      after.firstRow <= before.lastRow && after.lastRow >= before.firstRow,
      `visible message range changed: ${JSON.stringify({ before, after })}`,
    );
  } finally {
    await page.close();
  }
});

test("a reader already at the bottom remains there after host hiding", async () => {
  const page = await openChat({ count: 80, mode: "pin-to-bottom" });
  try {
    await page.waitForTimeout(600);
    assert.ok((await metrics(page)).fromBottom < 100);
    await hideAndRestore(page);
    assert.ok((await metrics(page)).fromBottom < 100);
  } finally {
    await page.close();
  }
});

test("switching threads while hidden opens the new thread at its end", async () => {
  const page = await openChat({ count: 80, mode: "pin-to-bottom" });
  try {
    await scrollAway(page);
    await page.locator("#hide").click();
    await page.waitForFunction(
      () => document.querySelector("#host").clientHeight === 0,
    );
    await page.locator("#switch-thread").click();
    await page.locator("#show").click();
    await page.locator("#rerender").click();
    await page.waitForTimeout(1100);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom < 100,
      `new thread did not open at end: ${JSON.stringify(after)}`,
    );
  } finally {
    await page.close();
  }
});

test("switching non-virtual threads while hidden opens the longer thread at its end", async () => {
  const page = await openChat({
    count: 20,
    nextCount: 30,
    mode: "pin-to-bottom",
  });
  try {
    await scrollAway(page);
    await page.locator("#hide").click();
    await page.waitForFunction(
      () => document.querySelector("#host").clientHeight === 0,
    );
    await page.locator("#switch-thread").click();
    await page.locator("#show").click();
    await page.locator("#rerender").click();
    await page.waitForTimeout(1100);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom < 100,
      `new non-virtual thread did not open at end: ${JSON.stringify(after)}`,
    );
  } finally {
    await page.close();
  }
});

test("a reader slightly above the pin threshold stays put after host hiding", async () => {
  const page = await openChat({ count: 20, mode: "pin-to-bottom" });
  try {
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
      const el = window.__chatScroll;
      el.scrollTop = el.scrollHeight - el.clientHeight - 85;
    });
    await page.waitForTimeout(350);
    const before = await metrics(page);
    assert.ok(
      before.fromBottom > 75 && before.fromBottom < 100,
      `test must start slightly above the pin threshold: ${JSON.stringify(before)}`,
    );
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      Math.abs(after.fromBottom - before.fromBottom) < 20,
      `near-bottom reader moved: ${JSON.stringify({ before, after })}`,
    );
  } finally {
    await page.close();
  }
});

test("hiding during a return-to-bottom animation keeps the bottom lock", async () => {
  const page = await openChat({ count: 20, mode: "pin-to-bottom" });
  try {
    await scrollAway(page);
    await page.evaluate(() =>
      document
        .querySelector('[data-testid="copilot-scroll-to-bottom"]')
        .click(),
    );
    await page.waitForTimeout(40);
    const midAnimation = await metrics(page);
    assert.ok(
      midAnimation.fromBottom > 100,
      `animation already finished before hiding: ${JSON.stringify(midAnimation)}`,
    );
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom < 100,
      `active pin was interrupted while hidden: ${JSON.stringify({ midAnimation, after })}`,
    );
  } finally {
    await page.close();
  }
});

test("keyboard scroll interrupts a return-to-bottom animation before hiding", async () => {
  const page = await openChat({ count: 20, mode: "pin-to-bottom" });
  try {
    await scrollAway(page);
    await page.evaluate(() => {
      const scroll = window.__chatScroll;
      scroll.tabIndex = 0;
      scroll.focus();
      document
        .querySelector('[data-testid="copilot-scroll-to-bottom"]')
        .click();
      scroll.focus();
    });
    await page.waitForTimeout(40);
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(250);
    const before = await metrics(page);
    assert.ok(
      before.fromBottom > 500,
      `keyboard did not interrupt the pin: ${JSON.stringify(before)}`,
    );
    await hideAndRestore(page);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom > 500 &&
        Math.abs(after.scrollTop - before.scrollTop) < 250,
      `interrupted pin resumed after hiding: ${JSON.stringify({ before, after })}`,
    );
  } finally {
    await page.close();
  }
});

test("hiding before the return-to-bottom animation's first frame keeps the pin", async () => {
  const page = await openChat({ count: 20, mode: "pin-to-bottom" });
  try {
    const before = await scrollAway(page);
    // Both clicks run in one browser task, before a scroll event or animation
    // frame can replace the prior reading offset.
    await page.evaluate(() => {
      document
        .querySelector('[data-testid="copilot-scroll-to-bottom"]')
        .click();
      document.querySelector("#hide").click();
    });
    await page.waitForFunction(
      () => document.querySelector("#host").clientHeight === 0,
    );
    await page.locator("#show").click();
    await page.locator("#rerender").click();
    await page.waitForTimeout(1100);
    const after = await metrics(page);
    assert.ok(
      after.fromBottom < 100,
      `pending pin was interrupted before its first frame: ${JSON.stringify({ before, after })}`,
    );
  } finally {
    await page.close();
  }
});
