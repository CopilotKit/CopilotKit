import type { RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { describe, expect, it } from "vitest";
import { parseConnectRequest, parseRunRequest } from "../shared/agent-utils";

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
