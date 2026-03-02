/**
 * Deno multi-endpoint server factory.
 *
 * Imports from specific dist files (not the barrel index.mjs) to avoid
 * pulling in hono/express/node endpoints. The dist pre-resolves
 * package.json to a .mjs file, avoiding Deno's JSON import restriction.
 */
import { createCopilotRuntimeHandler } from "../../../../dist/core/fetch-handler.mjs";
import { CopilotRuntime } from "../../../../dist/core/runtime.mjs";
import { InMemoryAgentRunner } from "../../../../dist/runner/in-memory.mjs";
import type { ServerHandle } from "../servers/types.ts";

const BASE_PATH = "/api/copilotkit";

function createFakeAgent(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
) {
  return {
    clone: () => {
      const instance = {
        setMessages: () => undefined,
        setState: () => undefined,
        threadId: "thread",
        headers: {} as Record<string, string>,
        runAgent: async (
          input: { runId: string },
          { onEvent }: { onEvent: (payload: { event: unknown }) => void },
        ) => {
          if (opts.capturedHeaders) {
            opts.capturedHeaders.push({ ...instance.headers });
          }
          onEvent({ event: { type: "RUN_STARTED", runId: input.runId, input: { runId: input.runId } } });
          onEvent({ event: { type: "TEXT_MESSAGE_START", messageId: "m1" } });
          onEvent({ event: { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Hello from test" } });
          onEvent({ event: { type: "TEXT_MESSAGE_END", messageId: "m1" } });
          onEvent({ event: { type: "RUN_FINISHED", runId: input.runId } });
        },
      };
      return instance;
    },
  };
}

export async function createDenoMultiServer(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
): Promise<ServerHandle> {
  const runtime = new CopilotRuntime({
    agents: { default: createFakeAgent(opts) as any },
    runner: new InMemoryAgentRunner(),
  });

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    cors: true,
  });

  const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
  const port = server.addr.port;

  return {
    baseUrl: `http://localhost:${port}`,
    basePath: BASE_PATH,
    close: async () => {
      await server.shutdown();
    },
  };
}
