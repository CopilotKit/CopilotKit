import { InMemoryAgentRunner } from "../../../runner/in-memory";

/**
 * Creates a fake agent that emits a deterministic sequence of AG-UI events.
 * Requires no API keys — purely in-memory.
 */
export function createFakeAgent(
  opts: { capturedHeaders?: Record<string, string>[] } = {},
) {
  return {
    clone: () => {
      const instance = {
        setMessages: () => undefined,
        setState: () => undefined,
        threadId: "thread",
        headers: {},
        runAgent: async (
          input: { runId: string },
          { onEvent }: { onEvent: (payload: { event: unknown }) => void },
        ) => {
          // Capture headers if requested
          if (opts.capturedHeaders) {
            opts.capturedHeaders.push({ ...instance.headers });
          }

          onEvent({
            event: {
              type: "RUN_STARTED",
              runId: input.runId,
              input: { runId: input.runId },
            },
          });
          onEvent({
            event: { type: "TEXT_MESSAGE_START", messageId: "m1" },
          });
          onEvent({
            event: {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "m1",
              delta: "Hello from test",
            },
          });
          onEvent({
            event: { type: "TEXT_MESSAGE_END", messageId: "m1" },
          });
          onEvent({
            event: { type: "RUN_FINISHED", runId: input.runId },
          });
        },
      };
      return instance;
    },
  };
}

export function createTestRunner() {
  return new InMemoryAgentRunner();
}
