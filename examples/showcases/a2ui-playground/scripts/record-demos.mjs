/**
 * Records one demo video per launch feature: the app at 1920x1080 (captured
 * at 2x density) with a caption band under it, 1920x1200 MP4, plus all of
 * them joined into one tour.
 *
 *   node scripts/record-demos.mjs <outDir> [scene,scene]
 *
 * Needs the dev server on :3100 (BASE to change it) and ffmpeg on PATH.
 * Scenes that run the agent say which model answered in their caption band;
 * set MOCK_MODEL=1 when the server points at a scripted mock instead of a
 * real model, so every such video says so.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const [, , outDir = "demo-videos", onlyArg] = process.argv;
const only = onlyArg?.split(",");
const BASE = process.env.BASE ?? "http://localhost:3100";
const MOCK = process.env.MOCK_MODEL === "1";
const W = 1440;
const H = 810;
const CAPS = join(outDir, ".captions");
mkdirSync(CAPS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--hide-scrollbars"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
});

/** A visible cursor (headless Chrome draws none) and no dev-mode badge. */
const OVERLAY = `(() => {
  const style = document.createElement("style");
  style.textContent = "nextjs-portal{display:none!important}#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;z-index:2147483647;transition:transform .12s ease}#demo-cursor.down{transform:scale(.82)}";
  const cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 21l-3.2 1.4-3.6-8.1L4 18.6z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const mount = () => { document.documentElement.appendChild(style); document.documentElement.appendChild(cursor); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
  addEventListener("mousemove", (e) => { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => cursor.classList.add("down"), true);
  addEventListener("mouseup", () => cursor.classList.remove("down"), true);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function helpers(page, captions, clock) {
  let mouse = { x: W / 2, y: H / 2 };
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  const h = {
    page,
    sleep,
    caption(text) {
      const t = clock();
      const last = captions[captions.length - 1];
      if (last && last.end == null) last.end = t;
      if (text) captions.push({ text, start: t, end: null });
    },
    async moveTo(x, y, ms = 450) {
      const from = { ...mouse };
      const steps = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const k = ease(i / steps);
        await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
        await sleep(ms / steps);
      }
      mouse = { x, y };
    },
    async point(selector, ms) {
      const el = await page.waitForSelector(selector, { visible: true, timeout: 30000 });
      await el.scrollIntoView();
      const b = await el.boundingBox();
      await h.moveTo(b.x + b.width / 2, b.y + b.height / 2, ms);
      return el;
    },
    async click(selector) {
      await h.point(selector);
      await sleep(120);
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      await sleep(250);
    },
    async type(text, delay = 42) {
      for (const ch of text) {
        await page.keyboard.type(ch);
        await sleep(delay + Math.random() * 30);
      }
    },
    /** Types a prompt into the chat, sends it and waits for the run to finish. */
    async ask(prompt, during) {
      await h.click("main textarea");
      await h.type(prompt);
      await sleep(250);
      await page.keyboard.press("Enter");
      if (during) during();
      await page.waitForFunction((p) => {
        const r = window.__runStore?.get().runs.at(-1);
        return r && r.prompt === p && r.status !== "running";
      }, { timeout: 90000 }, prompt);
      await sleep(600);
      await h.chatToBottom();
    },
    /** Eases the chat transcript to its newest surface. */
    async chatToBottom(ms = 900) {
      await page.evaluate(async (ms) => {
        const el = [...document.querySelectorAll(".pg-chat *")].find((n) => n.scrollHeight > n.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
        if (!el) return;
        const start = el.scrollTop;
        const end = el.scrollHeight - el.clientHeight;
        const t0 = performance.now();
        await new Promise((done) => {
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            el.scrollTop = start + (end - start) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
            k < 1 ? requestAnimationFrame(step) : done();
          };
          requestAnimationFrame(step);
        });
      }, ms);
    },
    /** Eases the window until `selector` sits `offset` pixels below the top. */
    async scrollTo(selector, ms = 1800, offset = 120) {
      const dy = await page.$eval(selector, (el, offset) => el.getBoundingClientRect().top - offset, offset);
      await h.scroll(dy, ms);
    },
    /** Eases the window (or the element matching `selector`) by dy pixels. */
    async scroll(dy, ms = 1400, selector) {
      await page.evaluate(
        async (dy, ms, selector) => {
          const el = selector ? document.querySelector(selector) : document.scrollingElement;
          const start = el.scrollTop;
          const t0 = performance.now();
          await new Promise((done) => {
            const step = (now) => {
              const k = Math.min(1, (now - t0) / ms);
              el.scrollTop = start + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
              k < 1 ? requestAnimationFrame(step) : done();
            };
            requestAnimationFrame(step);
          });
        },
        dy,
        ms,
        selector ?? null,
      );
    },
  };
  return h;
}

/** Page setup before recording: a function run in the page, and its arguments (closures do not reach the page). */
const RUN_SETTINGS = (format, model = "gemini") => ({ fn: (s) => localStorage.setItem("a2ui-run-settings", s), args: [JSON.stringify({ model, format })] });

const scenes = [
  {
    name: "01-express-vs-json",
    label: "Express vs JSON",
    agent: true,
    path: "/playground",
    setup: RUN_SETTINGS("express"),
    async run(d) {
      d.caption("A2UI Express is now the default format: the model writes one line per component.");
      await d.point('[data-format="express"]', 600);
      await sleep(1600);
      await d.ask("Q3 sales by region as a dashboard", () =>
        d.caption("Google's @a2ui/agent SDK compiles each line as it arrives, so the surface paints while it streams."),
      );
      await d.point("[data-payload]", 700);
      d.caption("The Build tab measures the same surface both ways: Express is about half the size of JSON.");
      await sleep(4200);
      await d.click('[data-format="json"]');
      d.caption("Switch to A2UI JSON and ask again.");
      await d.ask("Q3 sales by region as a dashboard");
      await d.point("[data-payload] table", 700);
      d.caption("Every composed run lands in one table: format, model, characters written and compose time.");
      await sleep(4500);
      await d.click('[data-tab="json"]');
      d.caption('And every operation on the wire says "version": "v1.0".');
      await sleep(3800);
    },
  },
  {
    name: "02-macros",
    label: "1.0 macros",
    agent: true,
    path: "/playground",
    setup: RUN_SETTINGS("express"),
    async run(d) {
      d.caption("Macros: the model writes one ProductCard(...) line per product.");
      await d.ask("Compare three noise-cancelling headphones", () =>
        d.caption("The server expands each macro into Gen UI 2.0 standard components. The browser has no ProductCard code."),
      );
      await sleep(2200);
      await d.click('[data-tab="stream"]');
      d.caption("The stream logs each expansion: one macro call becomes a dozen or more standard components.");
      await sleep(3800);
      await d.click('[data-tab="build"]');
      d.caption('A macro can load its own data: WeatherReport("Lisbon") fetches the live forecast, then expands.');
      await d.ask("Show me a live weather report for Lisbon");
      await sleep(2600);
      d.caption("The fixed flights template uses the FlightCard macro as its list row, with bound data.");
      await d.ask("Flights from SFO to JFK on Friday");
      await sleep(2600);
      await d.page.goto(`${BASE}/components/macros`, { waitUntil: "networkidle2" });
      d.caption("Every macro is documented: the one line of Express in, the standard components out.");
      await sleep(1500);
      await d.scroll(330, 1500);
      await sleep(1200);
      await d.click('[data-macro="FlightCard"] [data-macro-view="json"]');
      d.caption("Wire JSON: what actually reaches the renderer, plain A2UI v1.0.");
      await sleep(3200);
      await d.scroll(1500, 2600);
      await sleep(2000);
    },
  },
  {
    name: "03-model-picker",
    label: "Model picker",
    agent: true,
    path: "/playground",
    setup: RUN_SETTINGS("express"),
    async run(d) {
      d.caption("Gemini Flash is the default model.");
      await d.point("[data-model-picker]", 600);
      await d.ask("Q3 sales by region as a dashboard");
      await d.click("[data-model-picker]");
      d.caption("Gemma 4 runs locally through Ollama, and GPT is one click away.");
      await sleep(900);
      await d.point('[data-model="gpt"]', 500);
      await sleep(600);
      await d.click('[data-model="gemma"]');
      d.caption("Same prompt on Gemma 4: router and composer both run on the local model.");
      await d.ask("Q3 sales by region as a dashboard");
      await d.point("[data-payload] table", 700);
      d.caption("Each run records its model, so Gemini and Gemma sit side by side.");
      await sleep(3800);
      d.caption("Express is plain text, so the composer needs no tool calling: any model that can write can compose.");
      await sleep(4200);
    },
  },
  {
    name: "04-hand-editing",
    label: "Hand-editing",
    path: "/playground",
    setup: { fn: () => localStorage.removeItem("a2ui-inspector-tab"), args: [] },
    async run(d) {
      d.caption("Hand-edit A2UI JSON and watch it re-render. No model involved.");
      await d.click('[data-tab="json"]');
      await d.click("[data-json-edit-toggle]");
      await d.page.waitForSelector("[data-json-input]", { visible: true });
      await d.click('[aria-label="Widen the inspector"]');
      await sleep(900);
      const pos = await d.page.$eval("[data-json-input]", (el) => {
        const i = el.value.indexOf("Q3 revenue review");
        el.focus();
        el.setSelectionRange(i, i + "Q3 revenue review".length);
        return i;
      });
      if (pos >= 0) {
        await d.point("[data-json-input]", 500);
        d.caption("Change a title: the preview follows every keystroke.");
        await d.type("Q4 plan, edited by hand", 70);
        await sleep(1800);
        await d.page.$eval("[data-json-input]", (el) => {
          const i = el.value.indexOf('"Q4 plan, edited by hand",') + '"Q4 plan, edited by hand"'.length;
          el.setSelectionRange(i + 1, i + 1);
        });
        d.caption("Break the JSON: the problem is pinned to its line, and the preview keeps the last valid version.");
        await d.page.keyboard.press("Backspace");
        await sleep(3400);
        await d.type(",", 0);
        await sleep(1400);
      }
      d.caption("CopilotKit's own validator checks components and props as you type. Starters cover charts and forms.");
      await d.page.select("[data-json-source]", "charts");
      await sleep(3600);
    },
  },
  {
    name: "05-skill-export",
    label: "Skill export",
    path: "/skills",
    async run(d) {
      d.caption("Skill export: Google's A2UI TypeScript SDK compiles the catalog into agent skills.");
      await sleep(2400);
      await d.scroll(420, 1400);
      await d.click('[data-skill-file="a2ui-core/SKILL.md"]');
      d.caption("a2ui-core: how to write A2UI Express. The same for every catalog.");
      await sleep(2600);
      await d.click('[data-skill-file="a2ui-playground/SKILL.md"]');
      d.caption("a2ui-playground: every component and macro, when to use each, and worked examples.");
      await sleep(1200);
      await d.page.$eval("[data-skill-preview]", (el) => {
        const i = el.textContent.indexOf("### Examples");
        el.dataset.target = String(Math.max(0, (i / el.textContent.length) * el.scrollHeight - 120));
      });
      const target = Number(await d.page.$eval("[data-skill-preview]", (el) => el.dataset.target));
      await d.scroll(target, 2400, "[data-skill-preview]");
      await sleep(2800);
      await d.click('[data-skill-format="json"]');
      d.caption("The same skills for agents that write A2UI JSON.");
      await sleep(2400);
      await d.point("[data-skill-download]", 600);
      d.caption("Download them as a zip, or install them with one command.");
      await sleep(3000);
    },
  },
  {
    name: "06-evals",
    label: "Evals",
    path: "/evals",
    async run(d) {
      d.caption("Evals: valid-render rate, component choice, time and size, per model and format.");
      await sleep(2600);
      await d.point("[data-eval-label]", 600);
      d.caption("The results checked in come from the local mock model: they check the harness, not a model.");
      await sleep(3200);
      await d.scroll(480, 1600);
      d.caption("Valid render uses CopilotKit's own validateOperation, the check the browser runs before it paints.");
      await sleep(3000);
      await d.scroll(900, 2600);
      d.caption("Per task: what each answer used. Run pnpm evals with Gemini, Gemma or GPT for real scores.");
      await sleep(3200);
      await d.scroll(1200, 2200);
      await sleep(1600);
    },
  },
  {
    name: "07-use-it-in-your-app",
    label: "Use it in your app",
    path: "/",
    async run(d) {
      d.caption('From the landing page, "Use it in your app" leads to a getting-started path.');
      await sleep(1600);
      await d.click('a[href="/start"]:not(nav a)');
      await d.page.waitForSelector("h1");
      d.caption("Install command, the repo, and three files to wire your components to any agent.");
      await sleep(2400);
      await d.scroll(700, 2200);
      await sleep(1800);
      await d.scroll(1100, 2400);
      d.caption("Bring your own agent: a Google ADK agent behind the CopilotKit runtime, with no A2UI code in it.");
      await sleep(3200);
      await d.scrollTo('a[href="/catalog.json"]', 2400, 260);
      d.caption("And the catalog as a framework-agnostic A2UI v1.0 document, for renderers beyond React.");
      await d.point('a[href="/catalog.json"]', 700);
      await sleep(3600);
    },
  },
];

/** One caption as a 1920x120 PNG: the scene label, the line, and which model answered. */
async function renderCaption(page, file, label, text, note) {
  await page.setViewport({ width: 1920, height: 120, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;width:1920px;height:120px;background:#0b0b0d;border-top:1px solid #222228;box-sizing:border-box;display:flex;align-items:center;gap:28px;padding:0 56px;font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif">
    <span style="flex:none;font:600 15px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#b69cff">${label}</span>
    <span style="flex:1;font-size:29px;line-height:1.25;color:#f2f2f5;letter-spacing:-.005em">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>
    ${note ? `<span style="flex:none;font:13px ui-monospace,Menlo,monospace;color:#8a8a94;text-align:right">${note}</span>` : ""}
  </body></html>`);
  await page.screenshot({ path: file });
}

const made = [];
for (const scene of scenes) {
  if (only && !only.includes(scene.name)) continue;
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(OVERLAY);
  await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle2", timeout: 120000 });
  if (scene.setup) {
    await page.evaluate(scene.setup.fn, ...scene.setup.args);
    await page.reload({ waitUntil: "networkidle2" });
  }
  await sleep(1500);
  const raw = join(outDir, `${scene.name}.raw.mp4`);
  const captions = [];
  let t0 = 0;
  const d = helpers(page, captions, () => (Date.now() - t0) / 1000);
  await page.mouse.move(W / 2, H / 2);
  const recorder = await page.screencast({ path: raw, scale: 2 / 3, fps: 30 });
  t0 = Date.now();
  try {
    await scene.run(d);
  } catch (err) {
    console.error(`${scene.name}: ${err.message}`);
  }
  d.caption(null);
  await sleep(400);
  await recorder.stop();
  await page.close();

  // Caption band: one PNG per line, overlaid under the 1920x1080 screen while it is current.
  const note = scene.agent ? (MOCK ? "model: local mock, scripted\nall app code is real" : "") : "";
  const cap = await browser.newPage();
  const files = [];
  for (const [i, c] of captions.entries()) {
    const file = join(CAPS, `${scene.name}-${i}.png`);
    await renderCaption(cap, file, scene.label, c.text, note.replace("\n", "<br>"));
    files.push(file);
  }
  await cap.close();
  let graph = "[0:v]scale=1920:1080,pad=1920:1200:0:0:color=0x0b0b0d[v0]";
  captions.forEach((c, i) => {
    graph += `;[v${i}][${i + 1}:v]overlay=0:1080:enable='between(t,${c.start.toFixed(2)},${(c.end ?? 9999).toFixed(2)})'[v${i + 1}]`;
  });
  const final = join(outDir, `${scene.name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, ...files.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", `[v${captions.length}]`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", final]);
  made.push(final);
  console.log(`${final}: ${captions.length} captions`);
}

if (made.length > 1) {
  const list = join(outDir, ".concat.txt");
  writeFileSync(list, made.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const tour = join(outDir, "00-tour.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tour]);
  console.log(`${tour}: ${made.length} scenes`);
}
await browser.close();
