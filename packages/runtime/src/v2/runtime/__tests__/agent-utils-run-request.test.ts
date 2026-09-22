import { describe, expect, it } from "vitest";
import {
  parseConnectRequest,
  parseRunRequest,
} from "../handlers/shared/agent-utils";

function createRequest(body: unknown): Request {
  return new Request("https://example.com/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function legacyNullableInput() {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: { applicationValue: null },
    messages: [
      {
        id: "message-1",
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "data",
              value: "aGVsbG8=",
              mimeType: "image/png",
            },
            metadata: null,
          },
        ],
      },
    ],
    tools: [
      {
        name: "lookup",
        description: "Look up a value.",
        parameters: null,
      },
    ],
    context: [],
    forwardedProps: null,
    resume: [
      {
        interruptId: "interrupt-1",
        status: "resolved",
        payload: null,
      },
    ],
  };
}

describe("AG-UI request compatibility", () => {
  it("normalizes historically accepted null fields for run requests", async () => {
    const result = await parseRunRequest(createRequest(legacyNullableInput()));

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;

    expect(result.forwardedProps).toBeUndefined();
    expect(result.tools[0]?.parameters).toBeUndefined();
    expect(result.resume?.[0]?.payload).toBeUndefined();
    expect(result.messages[0]?.content).toEqual([
      {
        type: "image",
        source: {
          type: "data",
          value: "aGVsbG8=",
          mimeType: "image/png",
        },
      },
    ]);
    expect(result.state).toEqual({ applicationValue: null });
  });

  it("uses the same compatibility normalization for connect requests", async () => {
    const result = await parseConnectRequest(
      createRequest({ ...legacyNullableInput(), lastSeenEventId: "event-7" }),
    );

    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;

    expect(result.lastSeenEventId).toBe("event-7");
    expect(result.input.forwardedProps).toBeUndefined();
    expect(result.input.tools[0]?.parameters).toBeUndefined();
    expect(result.input.resume?.[0]?.payload).toBeUndefined();
  });

  it("keeps invalid message metadata null instead of stripping it", async () => {
    const body = legacyNullableInput();
    const result = await parseRunRequest(
      createRequest({
        ...body,
        messages: [{ ...body.messages[0], metadata: null }],
      }),
    );

    expect(result).toBeInstanceOf(Response);
  });
});
