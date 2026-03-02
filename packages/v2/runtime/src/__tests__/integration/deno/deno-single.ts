import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
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

export async function createDenoSingleServer(
  opts: { capturedHeaders?: Record<string, string>[]; port?: number } = {},
): Promise<ServerHandle> {
  const runtime = new CopilotRuntime({
    agents: { default: createFakeAgent(opts) as any },
    runner: new InMemoryAgentRunner(),
  });

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    mode: "single-route",
    cors: true,
  });

  const port = opts.port ?? 0;
  const server = Deno.serve({ port, onListen: () => {} }, handler);
  const actualPort = server.addr.port;

  return {
    baseUrl: `http://localhost:${actualPort}`,
    basePath: BASE_PATH,
    close: async () => {
      await server.shutdown();
    },
  };
}
