// Liveness front-door. This module is the process entry point (see
// entrypoint.sh). It binds an HTTP server on :8124/ok using ONLY `node:http`
// — zero heavy imports — so the watchdog has a valid probe target within
// milliseconds of `node` boot.
//
// ES modules resolve ALL top-level `import` statements before any module-body
// code runs. `@langchain/langgraph-api/server` (pulled in by server.mjs) takes
// ~4m30s to cold-import on Railway (graph eval + tsx transpile). The watchdog
// in entrypoint.sh allows 180s grace + 3×30s strikes = 270s before killing
// the container — roughly 4s short of when a probe embedded in server.mjs
// would actually bind. Kill-loop forever.
//
// Fix: bind :8124 first from a module with no heavy imports, THEN dynamic-
// import server.mjs to kick off the real langgraph bootstrap. Dynamic imports
// are evaluated at call time, not at module load time, so the listen callback
// fires before the heavy graph is touched.

import { createServer } from "node:http";

const PORT = Number(process.env.HEALTH_PORT || 8124);

createServer((req, res) => {
  if (req.url === "/ok") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}\n');
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, "0.0.0.0", () => {
  console.log(`[liveness] probe listening on 0.0.0.0:${PORT}`);
  // Defer real server start until AFTER liveness is bound.
  import("./server.mjs").catch((err) => {
    console.error("[liveness] server.mjs import failed:", err);
    process.exit(1);
  });
});
