import type { RunAgentInput } from "@ag-ui/client";
import type * as AgUiClient from "@ag-ui/client";
import { EventType, HttpAgent } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  BuiltInAgent,
  mockCustomStream,
} from "../../../../agent/__tests__/agent-test-helpers";
import { CopilotRuntime } from "../../core/runtime";
import { handleRunAgent } from "../handle-run";
import { parseConnectRequest, parseRunRequest } from "../shared/agent-utils";

// Request parsing must work without adding a compatibility helper to AG-UI's
// public API, including while this checkout still pins the previous preview.
vi.mock("@ag-ui/client", async (importOriginal) => {
  const client = {
    ...(await importOriginal<typeof AgUiClient>()),
  };
  Reflect.deleteProperty(client, "normalizeLegacyRunAgentInput");
  return client;
});

function inputBody(fields: object = {}) {
  return {
    threadId: "legacy-null-thread",
    runId: "legacy-null-run",
    messages: [],
    tools: [],
    context: [],
    ...fields,
  };
}

function requestFor(body: unknown) {
  return new Request("http://localhost/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const parsers = [
  { name: "run", parse: parseRunRequest },
  {
    name: "connect",
    async parse(request: Request): Promise<RunAgentInput | Response> {
      const result = await parseConnectRequest(request);
      return result instanceof Response ? result : result.input;
    },
  },
];

const mediaTypes = ["image", "audio", "video", "document"];
const legacyNullCases = [
  {
    name: "forwardedProps",
    fields: { forwardedProps: null },
    path: "forwardedProps",
  },
  {
    name: "tool parameters",
    fields: {
      tools: [
        { name: "lookup", description: "Look up a value", parameters: null },
      ],
    },
    path: "tools.0.parameters",
  },
  {
    name: "resume payload",
    fields: {
      resume: [{ interruptId: "approval", status: "resolved", payload: null }],
    },
    path: "resume.0.payload",
  },
  ...mediaTypes.map((type) => ({
    name: `${type} metadata`,
    fields: {
      messages: [
        {
          id: "media-message",
          role: "user",
          content: [
            {
              type,
              source: { type: "url", value: "https://example.com/media" },
              metadata: null,
            },
          ],
        },
      ],
    },
    path: "messages.0.content.0.metadata",
  })),
];

describe.each(["http", "built-in"])(
  "legacy requests executed by a %s agent",
  (kind) => {
    it.each(legacyNullCases)(
      "normalizes $name before execution and completes",
      async ({ fields }) => {
        const receivedInput = vi.fn<(input: unknown) => void>();
        const agent =
          kind === "http"
            ? new HttpAgent({
                url: "https://example.test/agent",
                fetch: async (_url, init) => {
                  if (typeof init?.body !== "string")
                    throw new Error("Expected a JSON request body");
                  const input = RunAgentInputSchema.parse(
                    JSON.parse(init.body),
                  );
                  receivedInput(input);
                  const ids = { threadId: input.threadId, runId: input.runId };
                  const events = [
                    { type: EventType.RUN_STARTED, ...ids },
                    { type: EventType.RUN_FINISHED, ...ids },
                  ];
                  return new Response(
                    events
                      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                      .join(""),
                    {
                      headers: { "Content-Type": "text/event-stream" },
                    },
                  );
                },
              })
            : new BuiltInAgent({
                type: "custom",
                factory: ({ input }) => {
                  receivedInput(input);
                  return mockCustomStream([]);
                },
              });
        const runtime = new CopilotRuntime({ agents: { legacy: agent } });

        const response = await handleRunAgent({
          runtime,
          request: requestFor(inputBody(fields)),
          agentId: "legacy",
        });

        expect(response.status).toBe(200);
        // The runtime SSE response can contain string chunks before a server
        // adapter encodes them, matching the existing handler integration tests.
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let stream = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stream +=
            typeof value === "string"
              ? value
              : decoder.decode(value, { stream: true });
        }
        stream += decoder.decode();
        expect(stream).toContain(EventType.RUN_FINISHED);
        expect(stream).not.toContain(EventType.RUN_ERROR);
        expect(receivedInput).toHaveBeenCalledTimes(1);
        expect(
          RunAgentInputSchema.safeParse(receivedInput.mock.calls[0][0]).success,
        ).toBe(true);
      },
    );
  },
);

describe.each(parsers)("$name request parsing", ({ parse }) => {
  it.each(legacyNullCases)(
    "omits legacy null $name before strict validation",
    async ({ fields, path }) => {
      const body = inputBody(fields);
      expect(RunAgentInputSchema.safeParse(body).success).toBe(false);

      const result = await parse(requestFor(body));

      expect(result).not.toBeInstanceOf(Response);
      expect(result).toMatchObject({
        threadId: body.threadId,
        runId: body.runId,
      });
      expect(result).not.toHaveProperty(path);
      expect(RunAgentInputSchema.safeParse(result).success).toBe(true);
    },
  );

  it("retains the existing null-state compatibility", async () => {
    const result = await parse(requestFor(inputBody({ state: null })));

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ state: undefined });
    expect(RunAgentInputSchema.safeParse(result).success).toBe(true);
  });

  it("preserves nested payload nulls and other falsy values", async () => {
    const payload = { value: null, values: [null, false, 0, ""] };
    const body = inputBody({
      state: payload,
      forwardedProps: payload,
      tools: [
        { name: "lookup", description: "Look up a value", parameters: payload },
      ],
      resume: [{ interruptId: "approval", status: "resolved", payload }],
      messages: [
        {
          id: "media-message",
          role: "user",
          content: mediaTypes.map((type) => ({
            type,
            source: { type: "url", value: "https://example.com/media" },
            metadata: payload,
          })),
        },
      ],
    });

    const result = await parse(requestFor(body));

    expect(result).toEqual(body);
    expect(RunAgentInputSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { name: "parentRunId", fields: { parentRunId: null } },
    {
      name: "tool metadata",
      fields: {
        tools: [
          { name: "lookup", description: "Look up a value", metadata: null },
        ],
      },
    },
    {
      name: "resume metadata",
      fields: {
        resume: [
          { interruptId: "approval", status: "resolved", metadata: null },
        ],
      },
    },
    {
      name: "message metadata",
      fields: {
        messages: [
          { id: "message", role: "user", content: "Hello", metadata: null },
        ],
      },
    },
  ])(
    "still rejects null $name that was invalid before the migration",
    async ({ fields }) => {
      const result = await parse(requestFor(inputBody(fields)));

      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) {
        throw new Error("Expected an invalid-request response");
      }
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({
        error: "Invalid request body",
      });
    },
  );
});

it("preserves the reconnect cursor while normalizing legacy input", async () => {
  const result = await parseConnectRequest(
    requestFor(inputBody({ forwardedProps: null, lastSeenEventId: "event-7" })),
  );

  expect(result).toMatchObject({ lastSeenEventId: "event-7" });
  expect(result).not.toHaveProperty("input.forwardedProps");
});
