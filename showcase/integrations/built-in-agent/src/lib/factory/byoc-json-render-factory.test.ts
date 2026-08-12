import { describe, expect, it, vi } from "vitest";

/**
 * `declarative-json-render` shipped rendering NOTHING — RUN_STARTED →
 * RUN_FINISHED with no events, no console error, no error banner — while its
 * D5/D6 rows stayed green, because aimock never enforces the precondition that
 * broke it. Two independent defects, one test file:
 *
 *  1. `text.format: json_object` requires the word "json" in the request's
 *     `input`. This adapter maps `systemPrompts` to `instructions`, not to
 *     input, so with the JSON directive only in SYSTEM_PROMPT the real API
 *     answered 400 on every run.
 *  2. The converter forwarded only TEXT_MESSAGE_CONTENT, so that 400 (a
 *     RUN_ERROR chunk) was silently dropped and the run looked merely empty.
 */

type Chunk = Record<string, unknown>;

const capture: {
  config?: { factory: (arg: unknown) => Promise<AsyncIterable<unknown>> };
  chatArgs?: Record<string, unknown>;
} = {};

let streamChunks: Chunk[] = [];

vi.mock("@copilotkit/runtime/v2", () => ({
  // `new`-able stand-in that just captures the config so the test can reach the
  // factory closure. A function rather than a class: the class form is a
  // constructor-only class, which the lint rules (rightly) flag.
  BuiltInAgent: function BuiltInAgentMock(this: unknown, config: never) {
    capture.config = config as never;
  },
  convertInputToTanStackAI: (input: { messages: unknown[] }) => ({
    messages: input.messages,
    systemPrompts: [],
  }),
}));

vi.mock("@tanstack/ai", () => ({
  chat: (args: Record<string, unknown>) => {
    capture.chatArgs = args;
    return (async function* () {
      for (const chunk of streamChunks) yield chunk;
    })();
  },
  maxIterations:
    (max: number) =>
    ({ iterationCount }: { iterationCount: number }) =>
      iterationCount < max,
}));

vi.mock("@tanstack/ai-openai", () => ({
  openaiText: (model: string) => ({ model }),
}));

vi.mock("../header-forwarding", () => ({ forwardingFetch: vi.fn() }));

// `@ag-ui/client` is a transitive of @copilotkit/runtime, not a direct
// dependency of this integration, so pnpm's strict layout does not expose it
// for a bare vitest run. Only the one member the factory emits is needed.
vi.mock("@ag-ui/client", () => ({
  EventType: { TEXT_MESSAGE_CHUNK: "TEXT_MESSAGE_CHUNK" },
}));

const { createByocJsonRenderAgent } =
  await import("./byoc-json-render-factory");

async function runFactory(chunks: Chunk[]) {
  streamChunks = chunks;
  createByocJsonRenderAgent();
  const stream = await capture.config!.factory({
    input: { messages: [{ role: "user", content: "Show me the dashboard" }] },
    abortController: new AbortController(),
  });
  const out: unknown[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("createByocJsonRenderAgent — json_object precondition", () => {
  it("puts the word json in the MESSAGES (the Responses API `input`)", async () => {
    await runFactory([]);
    const messages = capture.chatArgs!.messages as Array<{
      role: string;
      content: string;
    }>;
    // The precondition is about `input`, which is built from `messages` alone.
    const inputText = JSON.stringify(messages).toLowerCase();
    expect(inputText).toContain("json");
    // Prepended, so a user turn can never displace it.
    expect(messages[0]!.content.toLowerCase()).toContain("json");
  });

  it("still enforces json_object at the model", async () => {
    await runFactory([]);
    const modelOptions = capture.chatArgs!.modelOptions as {
      text?: { format?: { type?: string } };
    };
    expect(modelOptions.text?.format?.type).toBe("json_object");
  });

  it("does NOT rely on systemPrompts to satisfy the precondition", async () => {
    await runFactory([]);
    // Regression guard: moving the directive back into systemPrompts alone
    // reintroduces the 400, because those become `instructions`.
    const messages = capture.chatArgs!.messages as unknown[];
    expect(JSON.stringify(messages).toLowerCase()).toContain("json");
  });
});

describe("createByocJsonRenderAgent — converter", () => {
  it("forwards streamed text as assistant chunks", async () => {
    const events = (await runFactory([
      { type: "TEXT_MESSAGE_CONTENT", delta: '{"root":' },
      { type: "TEXT_MESSAGE_CONTENT", delta: '"a"}' },
      { type: "RUN_FINISHED" },
    ])) as Array<{ delta?: string }>;
    expect(events.map((e) => e.delta).join("")).toBe('{"root":"a"}');
  });

  it("THROWS on RUN_ERROR instead of ending the run silently", async () => {
    const message =
      "400 Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.";
    await expect(runFactory([{ type: "RUN_ERROR", message }])).rejects.toThrow(
      message,
    );
  });
});
