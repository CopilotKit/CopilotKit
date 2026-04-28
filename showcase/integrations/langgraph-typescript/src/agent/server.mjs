// LangGraph agent — production server (no CLI, no file watch, no Studio IPC).
//
// Dynamic-imported by liveness.mjs (the process entry point) AFTER :8124/ok
// is bound. The run invocation is `node --import tsx liveness.mjs`; tsx is
// used ONLY as a one-shot ESM import hook so subsequent imports (this file,
// graph.ts) resolve without recompilation per-request. Equivalent to
// langgraph-cli dev for the runs,
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
import { fileURLToPath } from "node:url";
import { startServer } from "@langchain/langgraph-api/server";
import { getStaticGraphSchema } from "@langchain/langgraph-api/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Liveness is now bound by liveness.mjs BEFORE this module is dynamic-imported
// — see showcase/integrations/langgraph-typescript/src/agent/liveness.mjs. The
// previous sibling-probe implementation inside this file did not work: ES
// module semantics resolve all top-level `import` statements before any
// module-body code runs, so `import { startServer } from "@langchain/
// langgraph-api/server"` (~4m30s cold on Railway) ran BEFORE the probe got a
// chance to listen, and the watchdog's 180s + 3×30s = 270s budget killed the
// container ~4s before the probe would have come up. By the time any code in
// this file executes, :8124/ok is already serving 200.

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
