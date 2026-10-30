// Drives the whole repo-doctor flow in a real browser and saves screenshots.
//
// Needs the app, the agent and a model running. With the scripted model:
//   pnpm mock-model
//   GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4010 GEMINI_API_KEY=mock pnpm dev
//   pnpm e2e
//
// It clicks the first repository card (google-gemini/genai-processors), approves every approval
// card as it appears, and checks that a passing test report, the diff card and
// the push render. Pass --beets to type the beets-filetote prompt instead,
// which also requires a failing test report before the green one. Pass --deny
// to deny the first approval instead, or --command to approve a built-in shell
// command.
import { mkdirSync } from "node:fs";
import { launch } from "puppeteer-core";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots";
const DENY = process.argv.includes("--deny");
// --command: ask for a package install, approve the shell command it proposes,
// and require the command's result row (exit code and output).
const COMMAND = process.argv.includes("--command");
// --beets: the older scripted run, where the tests go from red to green.
const BEETS = process.argv.includes("--beets");
// --check: the second card ("Check CI on ..."): CI is read, nothing is run or fixed.
const CHECK = process.argv.includes("--check");
// --js: a JS package through the generic install-and-test steps, no fix.
const JS = process.argv.includes("--js");
const JS_PROMPT = "Why is CI failing on sindresorhus/is-plain-obj?";
// --theme=light|dark seeds the stored theme choice before the page loads.
const THEME = process.argv.find((a) => a.startsWith("--theme="))?.split("=")[1];
const TIMEOUT = Number(process.env.E2E_TIMEOUT_MS ?? 420_000);

mkdirSync(OUT, { recursive: true });

const browser = await launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});

let step = 0;
/** Clicks the first match, re-querying each time: cards re-render while streaming. */
async function click(page, selector) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const clicked = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }, selector);
    if (clicked) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  fail(`Could not click ${selector}`);
}

async function shot(target, name) {
  step += 1;
  const path = `${OUT}/${String(step).padStart(2, "0")}-${name}.png`;
  await target.screenshot({ path });
  console.log(`  screenshot ${path}`);
}

function fail(message) {
  throw new Error(message);
}

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) =>
    console.log(`  page error: ${error.message}`),
  );
  // Runs as its own user, so its threads never mix with yours.
  await page.setCookie(
    { name: "rd_user", value: "e2e-mock", url: BASE_URL },
    { name: "rd_user_name", value: "E2E", url: BASE_URL },
  );
  if (THEME) {
    await page.evaluateOnNewDocument((theme) => {
      localStorage.setItem("repo-doctor-theme", theme);
    }, THEME);
  }
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="example-prompt"]', {
    timeout: 30_000,
  });
  // Let hydration and the runtime /info handshake settle before clicking.
  await new Promise((r) =>
    setTimeout(r, Number(process.env.E2E_SETTLE_MS ?? 1500)),
  );
  await shot(page, "welcome");

  if (COMMAND) {
    await page.type(
      '[data-testid="copilot-chat-textarea"]',
      "Please show the python version",
    );
    await page.keyboard.press("Enter");
    await page.waitForSelector(
      '[data-testid="approval-card"][data-tool="run_command"]',
      {
        timeout: 60_000,
      },
    );
    await shot(page, "approval-run_command");
    await click(page, '[data-testid="approval-approve"]');
    await page.waitForFunction(
      () => /Ran[\s\S]*exit \d+/.test(document.body.innerText),
      {
        timeout: 60_000,
      },
    );
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, "after-command");
    console.log("PASS (approved shell command ran)");
    await browser.close();
    process.exit(0);
  }
  if (BEETS || JS) {
    const prompt = BEETS
      ? "Why is CI failing on gtronset/beets-filetote?"
      : JS_PROMPT;
    await page.type('[data-testid="copilot-chat-textarea"]', prompt);
    await page.keyboard.press("Enter");
  } else if (CHECK) {
    await click(page, '[data-testid="example-prompt-secondary"]');
  } else {
    await click(page, '[data-testid="example-prompt"]');
  }
  const deadline = Date.now() + TIMEOUT;
  let approvals = 0;
  let sawRed = false;

  while (Date.now() < deadline) {
    const card = await page.$('[data-testid="approval-card"]');
    if (card) {
      const tool = await card.evaluate((el) => el.getAttribute("data-tool"));
      await new Promise((r) => setTimeout(r, 500));
      await shot(page, `approval-${tool}`);
      // Re-query: the chat re-renders while streaming, so the first handle can go stale.
      const settled = await page.$('[data-testid="approval-card"]');
      if (settled) await shot(settled, `card-approval-${tool}`);
      approvals += 1;
      if (DENY) {
        await click(page, '[data-testid="approval-deny"]');
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="approval-card"]'),
          { timeout: 30_000 },
        );
        await new Promise((r) => setTimeout(r, 2500));
        await shot(page, "after-deny");
        break;
      }
      await click(page, '[data-testid="approval-approve"]');
      // An approved shell command may download a Python or a package first.
      // Wait for the answer to land in the panel's history: the next card can
      // appear right away, so "no card on screen" is not a reliable signal.
      await page
        .waitForFunction(
          (answered) =>
            document.querySelectorAll('[aria-label="Approval history"] li')
              .length >= answered,
          { timeout: 120_000 },
          approvals,
        )
        .catch(async () => {
          await shot(page, `stuck-${tool}`);
          fail(`The ${tool} approval card never cleared after approving it`);
        });
      continue;
    }

    const reports = await page.$$eval('[data-testid="test-report"]', (els) =>
      els.map((el) => el.getAttribute("data-status")),
    );
    const headlines = await page.$$eval(
      '[data-testid="test-report-headline"]',
      (els) => els.map((el) => el.textContent ?? ""),
    );
    if (!sawRed && reports.includes("failed")) {
      if (!headlines.some((h) => /^\d+ of \d+ tests fail$/.test(h))) {
        fail(
          `The first test run did not produce per-test results: ${headlines.join(" | ")}`,
        );
      }
      sawRed = true;
      const red = (await page.$$('[data-testid="test-report"]'))[0];
      await new Promise((r) => setTimeout(r, 400));
      await shot(red, "card-tests-red");
    }
    const running = await page.evaluate(() =>
      Boolean(
        document.querySelector(
          '[data-testid="copilot-stop-button"], [aria-label="Stop"]',
        ),
      ),
    );
    // The generic paths end without a fix: CI read (and tests run, for --js).
    if ((CHECK || JS) && !running) {
      const done = await page.evaluate(
        (needsReport) =>
          /Checked CI|Could not read CI/.test(document.body.innerText) &&
          (!needsReport ||
            Boolean(document.querySelector('[data-testid="test-report"]'))) &&
          /Tell me/.test(document.querySelector(".chat-host")?.innerText ?? ""),
        JS,
      );
      if (done) break;
    }
    if (reports.at(-1) === "passed") {
      const pushed = await page.evaluate(() =>
        document.body.innerText.includes("Pushed fix/"),
      );
      if (pushed && !running) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (Date.now() >= deadline) {
    await shot(page, "timeout");
    const tail = await page.evaluate(() =>
      document.querySelector(".chat-host")?.innerText.slice(-800),
    );
    fail(`Timed out before the flow finished. Chat ends with:\n${tail}`);
  }
  await new Promise((r) => setTimeout(r, 1500));

  if (CHECK || JS) {
    await shot(page, CHECK ? "check-only" : "js-tests");
    if (CHECK && approvals !== 0)
      fail("The CI check asked for approval; it should only read");
  } else if (!DENY) {
    if (BEETS && !sawRed) fail("Never saw a failing test report");
    if (!(await page.$('[data-testid="diff-card"]')))
      fail("No diff card rendered");
    const diff = await page.$('[data-testid="diff-card"]');
    await shot(diff, "card-diff");
    const green = (await page.$$('[data-testid="test-report"]')).at(-1);
    await shot(green, "card-tests-green");
    // The product shot: the fix, the green run and the full workspace panel.
    await diff.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await new Promise((r) => setTimeout(r, 600));
    await shot(page, "demo");
    await page.evaluate(() => {
      const scroller = [...document.querySelectorAll("*")].find(
        (el) =>
          el.scrollHeight > el.clientHeight + 40 &&
          getComputedStyle(el).overflowY !== "visible" &&
          el.closest(".chat-host"),
      );
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });
    await new Promise((r) => setTimeout(r, 600));
    await shot(page, "done");
  }

  const approvalsLogged = await page.$$eval(
    '[aria-label="Approval history"] li',
    (els) => els.length,
  );
  console.log(
    `approvals answered: ${approvals}, logged in panel: ${approvalsLogged}`,
  );
  if (approvalsLogged !== approvals)
    fail("Approval history does not match the answers given");
  console.log(DENY ? "PASS (deny path)" : "PASS");
} finally {
  await browser.close();
}
