// RED repro server for the stdout-backpressure event-loop wedge.
//
// Models the production Next.js ($PORT) process from
// integrations/claude-sdk-python/entrypoint.sh:58, which runs with its stdout
// redirected through a bash process substitution `&> >(awk '{...; fflush()}')`.
// On the production Linux container, libuv treats that pipe stdout as a
// synchronous/blocking fd: console.log -> process.stdout.write -> a blocking
// write(2). We reproduce that exact condition explicitly and portably by
// setting the stdout handle to blocking mode (this is precisely the mode Node
// uses for a pipe stdout in the blocking case). See README.md for the full
// faithfulness statement and why setBlocking(true) is the honest model, not a
// cheat.
//
// Two HTTP surfaces on a SINGLE event loop (like Next.js):
//   GET /health  -> static, NO logging on its path. If the loop is wedged in a
//                   blocking write(2) on fd1, even this trivial route cannot
//                   respond. A 502/timeout on /health therefore proves an
//                   event-loop-WIDE stall (mirrors the real static
//                   src/app/api/health/route.ts).
//   (background)  -> a high-rate log flood via console.log, mirroring the real
//                   flood source: uvicorn access-log-per-request + the per-LLM
//                   CVDIAG "outbound-llm" breadcrumb (_header_forwarding.py:87),
//                   line-flushed (PYTHONUNBUFFERED / python -u).
//
// When the downstream reader (see reader.mjs) drains slower than the flood
// emits, the kernel pipe buffer fills; the next console.log blocks in write(2)
// on the shared event loop; /health stops responding; CPU drops toward 0 while
// the process stays resident (parked in the syscall, not spinning).

import http from "node:http";

// Make fd1 (stdout) a BLOCKING pipe write, exactly as the production Linux
// container does for a pipe stdout. Without this, modern Node (v22+) uses an
// async Socket for pipe stdout and buffers in userspace (no loop freeze, just
// unbounded memory growth) — see README "Faithfulness".
try {
  process.stdout._handle.setBlocking(true);
  process.stderr.write(
    "[repro] stdout set to BLOCKING (models Linux pipe fd1)\n",
  );
} catch (e) {
  process.stderr.write(
    `[repro] WARNING: could not set stdout blocking: ${e.message}\n`,
  );
  process.stderr.write(
    "[repro] repro may NOT wedge — see README faithfulness note\n",
  );
}

const PORT = parseInt(process.env.PORT || "9099", 10);
const FLOOD_LINES_PER_TICK = parseInt(
  process.env.FLOOD_LINES_PER_TICK || "500",
  10,
);
const FLOOD_TICK_MS = parseInt(process.env.FLOOD_TICK_MS || "100", 10);
// Delay the flood so the driver captures a clean window of healthy fast-200
// responses BEFORE the wedge — proving the fast-200 -> timeout transition,
// not just a wedged steady state.
const FLOOD_START_DELAY_MS = parseInt(
  process.env.FLOOD_START_DELAY_MS || "5000",
  10,
);

// FIXED lane (GREEN-1): model the stdout rate AFTER the MUST-1 fixes land.
//   - CVDIAG_LOG_STDOUT=0 (cvdiag_bootstrap.py) drops the per-LLM-call
//     "CVDIAG outbound-llm" breadcrumb line from stdout.
//   - uvicorn --no-access-log (entrypoint.sh) drops the per-request access line.
// The two lines that MADE the flood are exactly the two we emit below. With
// both removed, only a residual, sub-cap log volume remains (occasional real
// app log lines). We model that residual as a low FIXED_LINES_PER_TICK that
// stays comfortably UNDER the reader's drain cap, so the pipe never fills and
// the loop never wedges. This is NOT "delete the RED lane" — it is the same
// topology exercised at the post-fix rate. FIXED=0 keeps the original RED lane.
// CANONICAL FIXED PREDICATE (must be byte-identical with run.sh's IS_FIXED):
// FIXED is true IFF the lowercased value is exactly "1" or "true". Any other
// value (e.g. "yes", "on", "0", "false", "") is RED. This closes the
// false-GREEN hole where run.sh labelled a run GREEN while the server ran the
// RED flood because the two files used divergent truthiness rules.
const FIXED = ["1", "true"].includes((process.env.FIXED || "0").toLowerCase());
// Residual lines/tick when FIXED. Chosen well below the reader cap
// (CAP lines / TICK ms) so backpressure never builds. Default reader is
// 50 lines/sec; 1 line per 100ms tick = 10 lines/sec, ~5x under cap.
const FIXED_LINES_PER_TICK = parseInt(
  process.env.FIXED_LINES_PER_TICK || "1",
  10,
);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    // Static route. Deliberately NO console.log here — mirrors the real
    // src/app/api/health/route.ts (no upstream, no logging).
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", integration: "repro" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  process.stderr.write(`[repro] health server listening on :${PORT}\n`);

  // Mirror the real flood line shape: a uvicorn access line + a CVDIAG
  // outbound-llm breadcrumb, padded to a realistic length so the ~64KB pipe
  // buffer fills quickly.
  const accessLine = 'INFO: 127.0.0.1:0 - "POST /agent HTTP/1.1" 200 OK';
  const cvdiagLine =
    "CVDIAG component=backend-python boundary=outbound-llm run_id=REPRO slug=repro " +
    "x".repeat(120);
  // A single residual application log line for the FIXED lane — the sub-cap
  // volume that survives after the access line + CVDIAG breadcrumb are removed.
  const residualLine = "[nextjs] ready - started server on 0.0.0.0";
  let n = 0;
  const linesPerTick = FIXED ? FIXED_LINES_PER_TICK : FLOOD_LINES_PER_TICK;
  process.stderr.write(
    FIXED
      ? `[repro] FIXED lane: post-fix residual rate ${linesPerTick} line(s)/${FLOOD_TICK_MS}ms ` +
          `(CVDIAG breadcrumb + uvicorn access line REMOVED); health should stay fast-200\n`
      : `[repro] warm-up: no flood for ${FLOOD_START_DELAY_MS}ms (health should be fast-200)\n`,
  );
  setTimeout(() => {
    process.stderr.write(
      FIXED
        ? "[repro] FIXED START — residual sub-cap log volume only (no wedge expected)\n"
        : "[repro] FLOOD START — pipe will now fill and wedge the loop\n",
    );
    setInterval(() => {
      for (let i = 0; i < linesPerTick; i++) {
        n++;
        if (FIXED) {
          // Post-fix: the two flood sources (access line + CVDIAG breadcrumb)
          // are gone. Only a residual, sub-cap app log line remains.
          console.log(residualLine + ` n=${n}`);
        } else {
          // RED: these console.log calls are the blocking write(2) surface once
          // the pipe fills — this is where the event loop wedges.
          console.log(`[nextjs] ${accessLine}`);
          console.log(`[nextjs] ${cvdiagLine} n=${n}`);
        }
      }
      // Heartbeat on stderr (out-of-band, NOT through the wedged pipe) so the
      // driver can see whether the flood loop keeps advancing or freezes.
      process.stderr.write(`[repro] flood tick n=${n}\n`);
    }, FLOOD_TICK_MS);
  }, FLOOD_START_DELAY_MS);
});
