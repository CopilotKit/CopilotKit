// LangGraph agent — production server (no CLI, no file watch, no Studio IPC).
//
// Invoked as `node --import tsx server.mjs`. tsx is used ONLY as a one-shot
// ESM import hook so the initial import of graph.ts succeeds; nothing is
// recompiled per-request. Equivalent to langgraph-cli dev for the runs,
// threads, assistants, ok, and store surface but without:
//
//   - chokidar file watcher that recompiles on any .ts change,
//   - Studio auto-open and IPC handshake to smith.langchain.com,
//   - spawn.mjs parent/child process with `tsx watch` wrapping the server
//     (per dev.mjs to spawn.mjs to tsx cli.mjs watch entrypoint.mjs),
//   - dev-mode NODE_ENV=development forcing of LangSmith tenant ID lookup.
//
// Also pre-warms the in-memory schema cache at boot, mirroring what the
// official prod image's build.mts does at image build time — so the first
// assistants schemas request hits the cache instead of kicking off a cold
// TS worker compile.

import process from "node:process";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { startServer } from "@langchain/langgraph-api/server";
import { getStaticGraphSchema } from "@langchain/langgraph-api/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Liveness side-car. The main @langchain/langgraph-api Hono server on :8123
// only starts accepting connections AFTER `registerFromEnv` finishes the
// initial graph import + `Starting N workers` loop — on Railway this can take
// longer than the watchdog's 180s grace when the graph drags in the full
// schema-worker tsx pipeline. Running a bare HTTP server on a sibling port
// lets the entrypoint watchdog verify the process is alive and its event
// loop is responsive during cold-start, independent of how slow the Hono
// bind is. A true hang (event loop pinned) still fails this probe and
// triggers the container restart.
function startLivenessProbe() {
  const livenessPort = Number(process.env.HEALTH_PORT ?? 8124);
  const livenessHost = process.env.HOST ?? "0.0.0.0";
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"status":"not_found"}');
  });
  server.listen(livenessPort, livenessHost, () => {
    console.log(
      `[server] Liveness probe listening on ${livenessHost}:${livenessPort}`,
    );
  });
  server.on("error", (err) => {
    console.warn(`[server] Liveness probe error: ${err?.message ?? err}`);
  });
  return server;
}

// Graph spec mirrors langgraph.json. We pin the compiled .js entry because the
// production parser walks the source file with the TypeScript API; pointing at
// dist/graph.js still works because the parser reads whatever path we hand it,
// but the runtime import lives in the same location so no tsx is required.
const graphSpec = { starterAgent: "./graph.ts:graph" };

// Pre-warm schema cache before we accept traffic. This is what the official
// prod image's build.mts does at image-build time. We do it once at boot —
// same net effect, but cheap enough to run in-process during startup.
async function prewarmSchemas(cwd) {
  const specs = Object.fromEntries(
    Object.entries(graphSpec).map(([id, spec]) => {
      const [userFile, exportSymbol] = spec.split(":", 2);
      return [id, { sourceFile: path.resolve(cwd, userFile), exportSymbol }];
    }),
  );

  const start = Date.now();
  try {
    await getStaticGraphSchema(specs, { timeoutMs: 60_000 });
    console.log(`[server] Pre-warmed schemas in ${Date.now() - start}ms`);
  } catch (err) {
    // Non-fatal: server still starts; first /schemas call will trigger cold
    // extraction as the dev-mode path does today.
    console.warn(
      `[server] Pre-warm failed (non-fatal): ${err?.message ?? err}`,
    );
  }
}

async function main() {
  const cwd = __dirname; // src/agent
  const port = Number(process.env.PORT ?? 8123);
  const host = process.env.HOST ?? "0.0.0.0";

  // Bring the liveness probe up synchronously before any await — gives the
  // watchdog a valid /ok target within milliseconds of `node` boot.
  startLivenessProbe();

  // Kick off pre-warm and startServer in parallel. startServer registers
  // graphs synchronously and binds the port — /ok is live before schemas
  // finish warming.
  const [{ host: serverHost }] = await Promise.all([
    startServer({
      port,
      nWorkers: Number(process.env.N_WORKERS ?? 10),
      host,
      cwd,
      graphs: graphSpec,
    }),
    prewarmSchemas(cwd),
  ]);

  console.log(`[server] LangGraph API listening on ${serverHost}`);
}

main().catch((err) => {
  console.error("[server] Fatal:", err);
  process.exit(1);
});
