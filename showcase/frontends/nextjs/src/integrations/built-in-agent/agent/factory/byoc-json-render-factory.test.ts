import { EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  RunAgentInput,
  TextMessageChunkEvent,
} from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createByocJsonRenderAgent } from "./byoc-json-render-factory";

/**
 * `declarative-json-render` once rendered NOTHING while its aimock rows stayed
 * green, because aimock does not enforce the precondition that broke it:
 *
 *  1. `text.format: json_object` requires the word "json" in the request's
 *     `input`. The adapter sends `systemPrompts` as `instructions`, not as
 *     input, so a JSON directive that lives only in the system prompt makes
 *     the real API answer 400 on every run.
 *  2. A converter that drops the resulting RUN_ERROR chunk turns that 400
 *     into a silent, empty run.
 *
 * These tests run the real agent. A fake `fetch` stands in for the OpenAI
 * API, so nothing reaches the network.
 */

const JSON_MODE_REJECTION =
  "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.";

const fakeFetch = vi.fn<typeof fetch>();

// An OpenAI Responses stream whose text arrives in `deltas`.
function textStream(deltas: string[]) {
  const events = [
    {
      type: "response.created",
      response: { id: "resp_1", created_at: 0, model: "gpt-6-luna" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [] },
    },
    ...deltas.map((delta) => ({
      type: "response.output_text.delta",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
      delta,
    })),
    {
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

function runInput(): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [
      { id: "message-1", role: "user", content: "Show me the dashboard" },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function run() {
  return lastValueFrom(
    createByocJsonRenderAgent().run(runInput()).pipe(toArray()),
  );
}

// The JSON body of the request that reached the OpenAI API.
function sentBody() {
  const init = fakeFetch.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

function isTextChunk(event: BaseEvent): event is TextMessageChunkEvent {
  return event.type === EventType.TEXT_MESSAGE_CHUNK;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fakeFetch.mockReset();
});

describe("createByocJsonRenderAgent: json_object precondition", () => {
  it("enforces json_object at the model", async () => {
    fakeFetch.mockResolvedValue(textStream(["{}"]));

    await run();

    expect(sentBody().text.format.type).toBe("json_object");
  });

  it("puts the word json in the first item of the request's input", async () => {
    fakeFetch.mockResolvedValue(textStream(["{}"]));

    await run();

    // Prepended, so a user turn can never displace it. The system prompt
    // goes to `instructions`, which does not satisfy the precondition.
    const [first] = sentBody().input;
    expect(JSON.stringify(first).toLowerCase()).toContain("json");
  });
});

describe("createByocJsonRenderAgent: converter", () => {
  it("forwards streamed text as assistant chunks", async () => {
    fakeFetch.mockResolvedValue(textStream(['{"root":', '"a"}']));

    const events = await run();

    const text = events
      .filter(isTextChunk)
      .map((event) => event.delta)
      .join("");
    expect(text).toBe('{"root":"a"}');
  });

  it("fails the run with the API's message instead of ending it silently", async () => {
    fakeFetch.mockResolvedValue(
      Response.json(
        {
          error: {
            message: JSON_MODE_REJECTION,
            type: "invalid_request_error",
            param: "input",
            code: null,
          },
        },
        { status: 400 },
      ),
    );

    await expect(run()).rejects.toThrow(JSON_MODE_REJECTION);
  });
});
