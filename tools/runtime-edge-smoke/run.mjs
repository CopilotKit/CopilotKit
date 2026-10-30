/**
 * Edge smoke test for @copilotkit/runtime. It runs src/worker.ts on:
 *
 * - Cloudflare Workers (workerd, through wrangler) WITHOUT `nodejs_compat`;
 * - the Vercel Edge runtime (the `edge-runtime` VM that Vercel and Next.js
 *   use locally), bundled with the `edge-light` condition.
 *
 * On each one it checks GET /info and streams a run of the echo agent. It
 * also checks that the runtime's own dist imports no Node built-in, so that
 * a regression in our code cannot hide behind a stub. Run it with
 * `pnpm nx run runtime-edge-smoke:smoke` (it builds the runtime first).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { EdgeRuntime } from "edge-runtime";
import { unstable_startWorker } from "wrangler";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeDist = resolve(here, "../../packages/runtime/dist");

// Known blockers that have their own fix, stubbed so the rest of the runtime
// can be tested today. Keep in sync with `alias` in wrangler.jsonc; delete an
// entry when its fix lands.
const STUBS = {
  pino: "./stubs/pino.mjs",
  "pino-pretty": "./stubs/pino-pretty.mjs",
  "@ai-sdk/google-vertex": "./stubs/google-vertex.mjs",
  yauzl: "./stubs/yauzl.mjs",
  crypto: "./stubs/crypto.mjs",
};

// A Worker that throws while loading never becomes ready; fail instead of
// hanging (wrangler has already printed the error).
const STARTUP_TIMEOUT_MS = 60_000;

function withTimeout(promise, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} timed out; see the error above`)),
        STARTUP_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

const EXPECTED_EVENTS = [
  "RUN_STARTED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "RUN_FINISHED",
];

/** Fail if the runtime's own ESM output imports any Node built-in. */
function checkRuntimeDist() {
  const builtins = new Set(
    builtinModules.flatMap((name) => [name, `node:${name}`]),
  );
  const specifier =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      // node.mjs is the Node-only entry point (`@copilotkit/runtime/node`).
      else if (
        entry.name.endsWith(".mjs") &&
        path !== join(runtimeDist, "node.mjs")
      ) {
        const source = readFileSync(path, "utf8");
        for (const [, id] of source.matchAll(specifier)) {
          if (builtins.has(id))
            offenders.push(`${relative(runtimeDist, path)}: ${id}`);
        }
      }
    }
  };
  walk(runtimeDist);
  assert.deepEqual(offenders, [], "runtime dist imports Node built-ins");
}

function runInput(text) {
  return {
    threadId: "thread-1",
    runId: "run-1",
    messages: [{ id: "user-1", role: "user", content: text }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
}

/** GET /info and one streamed run, through any `fetch`-shaped function. */
async function exercise(name, fetchWorker) {
  const info = await fetchWorker("http://smoke.test/api/copilotkit/info");
  assert.equal(info.status, 200, `${name}: /info status`);
  const body = await info.json();
  assert.ok(body.agents?.default, `${name}: /info lists the default agent`);

  const run = await fetchWorker(
    "http://smoke.test/api/copilotkit/agent/default/run",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(runInput("hello edge")),
    },
  );
  const text = await run.text();
  assert.equal(
    run.status,
    200,
    `${name}: run status (body: ${text.slice(0, 500)})`,
  );
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
  assert.deepEqual(
    events.map((event) => event.type),
    EXPECTED_EVENTS,
    `${name}: run event order`,
  );
  const content = events.find((e) => e.type === "TEXT_MESSAGE_CONTENT");
  assert.equal(content.delta, "echo: hello edge", `${name}: echoed text`);
  console.log(`✓ ${name}: /info 200, run streamed ${events.length} events`);
}

async function cloudflareWorkers() {
  const worker = await unstable_startWorker({
    config: join(here, "wrangler.jsonc"),
    dev: { server: { port: 0 }, inspector: false, logLevel: "warn" },
  });
  try {
    await withTimeout(worker.ready, "Starting the Worker");
    await exercise(
      "Cloudflare Workers (no nodejs_compat)",
      async (url, init) => {
        const response = await worker.fetch(url, init);
        // Miniflare responses are undici-backed; normalize for the assertions.
        return new Response(await response.arrayBuffer(), response);
      },
    );
  } finally {
    await withTimeout(worker.dispose(), "Stopping the Worker");
  }
}

async function vercelEdge() {
  const bundle = await build({
    entryPoints: [join(here, "src/worker.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__edgeSmoke",
    platform: "browser",
    // The conditions Vercel resolves for Edge Functions.
    conditions: ["edge-light", "worker", "browser"],
    alias: Object.fromEntries(
      Object.entries(STUBS).map(([id, path]) => [id, join(here, path)]),
    ),
    logLevel: "error",
  });
  const runtime = new EdgeRuntime({
    initialCode: `${bundle.outputFiles[0].text}
      addEventListener("fetch", (event) => {
        event.respondWith(__edgeSmoke.default.fetch(event.request));
      });`,
  });
  await exercise("Vercel Edge runtime", (url, init) =>
    runtime.dispatchFetch(url, init),
  );
}

try {
  checkRuntimeDist();
  console.log(
    "✓ runtime dist: no Node built-in imports outside the /node entry",
  );
  await cloudflareWorkers();
  await vercelEdge();
} catch (error) {
  console.error(error);
  // A Worker that failed to start can keep wrangler's handles open.
  process.exit(1);
}
process.exit(0);
