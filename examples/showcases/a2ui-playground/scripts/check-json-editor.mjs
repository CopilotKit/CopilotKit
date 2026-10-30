/**
 * Checks the JSON tab's editing mode in headless Chrome, with no model:
 * starter -> edit a Title -> preview updates -> break the JSON -> error shows,
 * preview keeps the last good render -> invalid op / prop type -> reset ->
 * another starter -> widen. Then (optional) the same against an agent surface.
 *
 *   node scripts/check-json-editor.mjs <outDir> [agentPrompt]
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const [, , out = "json-editor-shots", agentPrompt = ""] = process.argv;
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3100";

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) =>
  errors.push(`pageerror: ${String(e)}`.slice(0, 300)),
);
page.on("console", (m) => {
  if (m.type() === "error")
    errors.push(`console.error: ${m.text()}`.slice(0, 300));
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(700);
const shot = async (name) => {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  return path;
};
const editorText = () => page.$eval("[data-json-input]", (el) => el.value);
const previewText = () =>
  page.$eval("[data-json-preview]", (el) => el.innerText);
const previewState = () =>
  page.$eval("[data-json-preview-state]", (el) =>
    el.getAttribute("data-json-preview-state"),
  );
const problems = () =>
  page.$$eval("[data-json-problems] li", (els) =>
    els.map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  );
/** Selects the `nth` occurrence of `find` in the editor (and optionally only part of it), then types `text` over it. */
async function replaceInEditor(
  find,
  text,
  { offset = 0, length = find.length } = {},
) {
  const at = await page.$eval(
    "[data-json-input]",
    (el, find, offset, length) => {
      const i = el.value.indexOf(find);
      if (i < 0) return -1;
      el.focus();
      el.setSelectionRange(i + offset, i + offset + length);
      return i;
    },
    find,
    offset,
    length,
  );
  if (at < 0) throw new Error(`"${find}" not in the editor`);
  if (text === "") await page.keyboard.press("Backspace");
  else await page.keyboard.type(text);
}

await page.goto(`${BASE}/playground`, {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await page.evaluate(() => localStorage.setItem("a2ui-inspector-tab", "json"));
await page.reload({ waitUntil: "networkidle2" });
await page.waitForSelector('[data-tab="json"]', { visible: true });
await page.click('[data-tab="json"]');
await sleep(400);
check(
  "JSON tab shows an Edit toggle with no surface",
  await page.$("[data-json-edit-toggle]"),
);
await shot("01-json-tab-empty");

// --- No model: starter
await page.click("[data-json-edit-toggle]");
await page.waitForSelector("[data-json-input]", { visible: true });
await page.waitForFunction(
  () =>
    document
      .querySelector("[data-json-preview]")
      ?.innerText.includes("Q3 revenue review"),
  { timeout: 20000 },
);
const sources = await page.$$eval("[data-json-source] option", (els) =>
  els.map((e) => `${e.value}:${e.textContent}`),
);
check(
  "starter picker lists 3-5 starters",
  sources.length >= 3 && sources.length <= 5,
  sources.join(", "),
);
check(
  "preview renders the starter with no model",
  (await previewText()).includes("Q3 revenue review"),
);
check(
  "status says valid",
  (await page.$eval("[data-json-status]", (e) =>
    e.getAttribute("data-json-status"),
  )) === "ok",
);
await shot("02-edit-starter");

// Edit a Title's text: typed into the textarea, debounced, re-rendered.
await replaceInEditor("Q3 revenue review", "Q4 revenue review, edited by hand");
await sleep(80);
check(
  "no re-render before the debounce",
  !(await previewText()).includes("edited by hand"),
);
await settle();
check(
  "preview shows the edited Title",
  (await previewText()).includes("Q4 revenue review, edited by hand"),
);
check("preview state is live", (await previewState()) === "live");
await shot("03-edited-title");

// Break the JSON: delete the comma after the Title's text.
await replaceInEditor('"Q4 revenue review, edited by hand",', "", {
  offset: '"Q4 revenue review, edited by hand"'.length,
  length: 1,
});
await settle();
let probs = await problems();
check(
  "syntax error is listed with its line",
  probs.some(
    (p) => /^JSON .*Ln \d+, Col \d+/.test(p) && /Expected , or }/.test(p),
  ),
  probs[0],
);
check(
  "preview keeps the last good render",
  (await previewText()).includes("Q4 revenue review, edited by hand"),
);
check(
  "preview is marked as the last valid version",
  (await previewState()) === "stale",
);
check(
  "status shows a problem",
  (await page.$eval("[data-json-status]", (e) =>
    e.getAttribute("data-json-status"),
  )) === "error",
);
check("the error line is highlighted", await page.$(".pg-jed-error-band"));
await shot("04-syntax-error");

// Click the problem: caret jumps to it.
await page.click("[data-json-problems] li button");
const caretLine = await page.$eval(
  "[data-json-input]",
  (el) => el.value.slice(0, el.selectionStart).split("\n").length,
);
check(
  "clicking the problem moves the caret to its line",
  probs[0].includes(`Ln ${caretLine},`),
  `caret on line ${caretLine}`,
);

// Fix it, then make an operation invalid: an unknown component type.
await replaceInEditor('"Q4 revenue review, edited by hand"', ",", {
  offset: '"Q4 revenue review, edited by hand"'.length,
  length: 0,
});
await settle();
check(
  "fixing the comma clears the problems",
  (await problems()).length === 0 && (await previewState()) === "live",
);
await replaceInEditor('"component": "Title"', "Titel", {
  offset: '"component": "'.length,
  length: 5,
});
await settle();
probs = await problems();
check(
  "validateOperation error names op, kind, component id and message",
  probs.some(
    (p) =>
      p.includes("Op 1") &&
      p.includes("createSurface") &&
      p.includes("#title") &&
      p.includes('unknown component "Titel"'),
  ),
  probs[0],
);
check(
  "preview still shows the last valid version",
  (await previewText()).includes("Q4 revenue review, edited by hand") &&
    (await previewState()) === "stale",
);
await shot("05-unknown-component");

// Restore the type, then a prop-type error (enum) the manager would reject.
await replaceInEditor('"component": "Titel"', "Title", {
  offset: '"component": "'.length,
  length: 5,
});
await replaceInEditor('"size": "lg"', "huge", {
  offset: '"size": "'.length,
  length: 2,
});
await settle();
probs = await problems();
check(
  "prop-type error is listed",
  probs.some(
    (p) => p.includes("#title") && p.startsWith("Op 1") && /size/.test(p),
  ),
  probs[0],
);
await shot("06-prop-type-error");

// Reset restores the starter.
await page.click("[data-json-reset]");
await settle();
check(
  "Reset restores the original ops",
  (await editorText()).includes("Q3 revenue review") &&
    (await previewText()).includes("Q3 revenue review") &&
    (await problems()).length === 0,
);

// Another starter: the form.
await page.select("[data-json-source]", "form");
await settle();
await sleep(600);
check(
  "form starter renders",
  (await previewText()).includes("Workspace settings"),
);
await shot("07-form-starter");
await page.select("[data-json-source]", "charts");
await settle();
await sleep(1200);
check(
  "chart starter renders",
  (await previewText()).includes("Infrastructure at a glance"),
);
await shot("08-charts-starter");

// Copy uses the edited text.
await replaceInEditor("Infrastructure at a glance", "Infra, edited");
await settle();
// Headless Chrome denies the real clipboard, so record what the button writes.
await page.evaluate(() => {
  navigator.clipboard.writeText = async (t) => {
    window.__copied = t;
  };
});
await page.click("[data-json-editor] button:has(svg.lucide-copy)");
await sleep(100);
const clip = await page.evaluate(() => window.__copied ?? "");
check(
  "Copy copies the edited text",
  clip.includes("Infra, edited") && clip === (await editorText()),
);

// Widen: side by side.
await page.click('[aria-label="Widen the inspector"]');
await sleep(1200);
const asideW = await page.$eval(
  "aside",
  (el) => el.getBoundingClientRect().width,
);
const sideBySide = await page.$eval(
  "[data-json-preview]",
  (el) => el.closest(".pg-jed-right").getBoundingClientRect().top < 200,
);
check(
  "widen makes the inspector wider, editor and preview side by side",
  asideW > 800 && sideBySide,
  `aside ${Math.round(asideW)}px`,
);
await shot("09-wide-side-by-side");
await page.click('[aria-label="Narrow the inspector"]');
await sleep(400);

// Tab switch keeps the session.
await page.click('[data-tab="build"]');
await sleep(300);
await page.click('[data-tab="json"]');
await page.waitForSelector("[data-json-input]");
check(
  "switching tabs keeps the edits",
  (await editorText()).includes("Infra, edited"),
);

// Done: back to read-only.
await page.click("[data-json-edit-toggle]");
await sleep(300);
check("Edit toggle leaves edit mode", !(await page.$("[data-json-input]")));

// --- With an agent surface (mock model), when a prompt is given.
if (agentPrompt) {
  const chat = await page.waitForSelector("main textarea", { timeout: 30000 });
  await chat.click();
  await chat.type(agentPrompt);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => {
      const r = window.__runStore?.current();
      return r && r.status !== "running";
    },
    { timeout: 120000, polling: 200 },
  );
  await sleep(1500);
  const surface = await page.evaluate(() => {
    const s = window.__runStore.get();
    const rec = s.selected ? s.surfaces[s.selected] : null;
    return rec
      ? {
          surfaceId: rec.surfaceId,
          ops: rec.ops.length,
          components: rec.componentCount,
        }
      : null;
  });
  check("agent run produced a surface", surface, JSON.stringify(surface));
  if (surface) {
    await shot("10-agent-surface-readonly");
    await page.click("[data-json-edit-toggle]");
    await page.waitForSelector("[data-json-input]");
    await settle();
    const src = await page.$eval("[data-json-source]", (el) => el.value);
    check(
      "editor opens on the agent's ops",
      src === "agent" && (await editorText()).includes(surface.surfaceId),
    );
    const agentProblems = await problems();
    check(
      "agent ops validate clean in the editor",
      !agentProblems.some((p) => !p.includes("warning")) ||
        agentProblems.length === 0,
      agentProblems.slice(0, 3).join(" | "),
    );
    // Change the first "title" or "text" string value in the ops.
    const target = await page.$eval("[data-json-input]", (el) => {
      const m = /"(title|text|label)": "([^"]{3,})"/.exec(el.value);
      return m ? m[2] : null;
    });
    if (target) {
      await page
        .waitForFunction(
          (t) =>
            document
              .querySelector("[data-json-preview]")
              ?.innerText.includes(t),
          { timeout: 15000 },
          target,
        )
        .catch(() => {});
      await replaceInEditor(target, "Edited without a model");
      await settle();
      check(
        "agent surface preview re-renders the edit",
        (await previewText()).includes("Edited without a model"),
        `replaced "${target}"`,
      );
      await shot("11-agent-surface-edited");
      await page.click("[data-json-reset]");
      await settle();
      check(
        "Reset restores the agent's ops",
        (await editorText()).includes(target) &&
          !(await editorText()).includes("Edited without a model"),
      );
    } else check("found a text value to edit in the agent ops", false);
  }
}

console.log(
  JSON.stringify(
    {
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).map((r) => r.name),
      errors: errors.slice(0, 12),
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
