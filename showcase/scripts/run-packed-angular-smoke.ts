import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { Page } from "playwright";

import { validateAngularSsrHtml } from "../../scripts/release/lib/angular-package";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("could not reserve a TCP port for the Angular SSR smoke");
  }
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForSsr(
  url: string,
  server: ChildProcess,
  readLogs: () => string,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  let lastError = "server did not respond";

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Angular SSR server exited with code ${server.exitCode}:\n${readLogs()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }

  throw new Error(
    `Angular SSR server was not ready within 30 seconds (${lastError}):\n${readLogs()}`,
  );
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(5_000)]);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
}

async function assertText(
  page: Page,
  selector: string,
  expected: string,
): Promise<void> {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible" });
  const actual = (await locator.innerText()).replace(/\s+/g, " ").trim();
  if (actual !== expected) {
    throw new Error(
      `expected ${selector} to contain exactly ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`,
    );
  }
}

/** Runs the packed Angular fixture through SSR, hydration, and browser flows. */
async function runBrowserSmoke(consumerDir: string): Promise<void> {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(
    process.execPath,
    [join(consumerDir, "dist/smoke/server/server.mjs")],
    {
      cwd: consumerDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverLogs = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    serverLogs += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    serverLogs += chunk.toString();
  });

  try {
    const html = await waitForSsr(url, server, () => serverLogs);
    const ssrProblems = validateAngularSsrHtml(html);
    if (ssrProblems.length) {
      throw new Error(
        `packed Angular SSR response violations:\n${ssrProblems
          .map((problem) => `  - ${problem}`)
          .join("\n")}`,
      );
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        const text = message.text();
        if (
          message.type() === "error" ||
          (message.type() === "warning" && /hydration|NG05\d{2}/i.test(text))
        ) {
          browserErrors.push(text);
        }
      });

      await page.goto(url, { waitUntil: "networkidle" });
      await page
        .locator('copilot-smoke[data-hydrated="true"]')
        .waitFor({ state: "attached" });
      await assertText(
        page,
        '[data-testid="tool-renderer"]',
        "packed:complete",
      );
      await assertText(page, '[data-testid="lifecycle-count"]', "1");

      const popupToggle = page.locator("[data-copilot-popup-toggle]");
      await popupToggle.click();
      await page
        .getByRole("dialog", { name: "Packed consumer chat" })
        .waitFor();
      await page.locator("copilot-chat").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Close Copilot chat",
      );
      const textarea = page.locator("copilot-chat textarea");
      await textarea.fill("packed consumer chat input");
      if ((await textarea.inputValue()) !== "packed consumer chat input") {
        throw new Error("packed Angular chat textarea did not retain input");
      }
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute("data-copilot-popup-toggle"),
      );

      await page.locator('[data-testid="destroy-probe"]').click();
      await assertText(page, '[data-testid="lifecycle-count"]', "0");
      await page
        .locator('[data-testid="lifecycle-probe"]')
        .waitFor({ state: "detached" });

      await delay(100);
      if (browserErrors.length) {
        throw new Error(
          `packed Angular browser emitted errors:\n${browserErrors
            .map((error) => `  - ${error}`)
            .join("\n")}`,
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopServer(server);
  }
}

const consumerDir = process.argv[2];
if (!consumerDir) {
  throw new Error("usage: run-packed-angular-smoke.ts <consumer-directory>");
}

runBrowserSmoke(resolve(consumerDir)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
