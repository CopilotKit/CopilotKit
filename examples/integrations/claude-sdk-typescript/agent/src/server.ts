/**
 * Claude Agent SDK (TypeScript) starter — AG-UI SSE server.
 *
 * Serves the agent (defined in src/agent.ts) over AG-UI: `POST /` streams
 * `adapter.run(input)`, `GET /health` reports status. Runs on port 8000.
 *
 * (The TypeScript adapter ships no FastAPI-style helper like the Python package's
 * `add_claude_fastapi_endpoint`, so this is the tiny node:http equivalent.)
 */

import http from "node:http";

import { EventType } from "@ag-ui/core";
import type { RunAgentInput } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import { adapter } from "./agent";

const PORT = Number.parseInt(process.env.AGENT_PORT || "8000", 10);
const HOST = process.env.AGENT_HOST || "0.0.0.0";

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host}`)
    .pathname;

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && pathname === "/") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    let input: RunAgentInput;
    try {
      input = JSON.parse(
        Buffer.concat(chunks).toString("utf-8"),
      ) as RunAgentInput;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const encoder = new EventEncoder({
      accept: req.headers.accept ?? "text/event-stream",
    });
    res.writeHead(200, {
      "Content-Type": encoder.getContentType(),
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // The adapter emits RUN_STARTED/RUN_FINISHED/RUN_ERROR itself; the error
    // callback surfaces the message as a clean RUN_ERROR (never a broken stream).
    adapter.run(input).subscribe({
      next: (event) => res.write(encoder.encode(event)),
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[agent] run error: ${message}`);
        res.write(
          encoder.encode({ type: EventType.RUN_ERROR, message } as never),
        );
        res.end();
      },
      complete: () => res.end(),
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(
    `[agent] Claude Agent SDK (TypeScript) starter listening on http://${HOST}:${PORT}`,
  );
});
