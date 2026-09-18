// Agno Showcase workaround for @copilotkit/runtime 1.68.2.
// Source boundary: src/v2/runtime/handlers/sse/run.ts. See README.md.
const { EventEncoder } = require("@ag-ui/encoder");
const { resolveMcpAppsServers } = require("../shared/mcp-apps-servers.cjs");

function validIdentifier(value) {
  return typeof value === "string" && value.length > 0;
}

function validProxy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    validIdentifier(value.method) &&
    (value.serverId === undefined || validIdentifier(value.serverId)) &&
    (value.serverHash === undefined || validIdentifier(value.serverHash)) &&
    (validIdentifier(value.serverId) || validIdentifier(value.serverHash)) &&
    (value.params === undefined ||
      (value.params !== null &&
        typeof value.params === "object" &&
        !Array.isArray(value.params)))
  );
}

function handleMcpProxy({
  runtime,
  request,
  agent,
  input,
  agentId,
  startTime,
  runtimeErrorReporter,
}) {
  if (
    !Object.prototype.hasOwnProperty.call(
      input.forwardedProps ?? {},
      "__proxiedMCPRequest",
    )
  )
    return;
  if (!validProxy(input.forwardedProps.__proxiedMCPRequest)) {
    return Response.json(
      { error: "Invalid MCP proxy request" },
      { status: 400 },
    );
  }
  if (
    !resolveMcpAppsServers(runtime.mcpApps?.servers ?? [], agentId).length ||
    typeof agent.use !== "function"
  ) {
    return Response.json(
      { error: "MCP proxy is not configured for this agent" },
      { status: 400 },
    );
  }

  const encoder = new EventEncoder();
  let closed = false;
  let cancelled = false;
  let settled = false;
  let controller;
  const detach = () => {
    void agent.detachActiveRun().catch((error) => {
      console.error("Failed to detach MCP proxy request:", error);
    });
  };
  const cancel = () => {
    if (settled || cancelled) return;
    cancelled = true;
    request.signal.removeEventListener("abort", abort);
    try {
      agent.abortRun();
    } catch (error) {
      console.error("Failed to abort MCP proxy request:", error);
    }
    detach();
  };
  const close = () => {
    request.signal.removeEventListener("abort", abort);
    if (closed) return;
    closed = true;
    controller.close();
  };
  const abort = () => {
    cancel();
    close();
  };
  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) {
        abort();
        return;
      }
      void Promise.resolve()
        .then(() =>
          agent.runAgent(input, {
            onEvent: ({ event }) => {
              if (cancelled) {
                // Initialization can finish after the initial detach attempt.
                // Never await detach within the event pipeline it must finish.
                detach();
                return { stopPropagation: true };
              }
              if (!closed) controller.enqueue(encoder.encodeBinary(event));
            },
          }),
        )
        .then(() => {
          settled = true;
          close();
        })
        .catch((error) => {
          settled = true;
          if (!cancelled && !closed) {
            runtimeErrorReporter?.report({
              request,
              error,
              operation: "agent.run",
              agentId,
              threadId: input.threadId,
              runId: input.runId,
              phase: "sse.subscription",
              startTime,
            });
            controller.enqueue(
              encoder.encodeBinary({
                type: "RUN_ERROR",
                message: "MCP proxy request failed",
              }),
            );
          }
          close();
        });
    },
    cancel() {
      closed = true;
      cancel();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

module.exports = { handleMcpProxy };
