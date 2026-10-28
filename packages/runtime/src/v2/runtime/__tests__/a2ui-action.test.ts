import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { firstValueFrom, of, toArray } from "rxjs";
import { describe, expect, it } from "vitest";
import { normalizeA2UIAction } from "../handlers/shared/a2ui-action";

const envelope = {
  version: "v0.9",
  userAction: {
    name: "book_flight",
    surfaceId: "flight-search-results",
    sourceComponentId: "flight-card",
    context: { flightNumber: "EA707", price: "$349", nested: [false, null, 2] },
    timestamp: "2026-10-28T17:42:24.743Z",
  },
};
const input = (): RunAgentInput => ({
  threadId: "public-thread",
  runId: "click-1",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: { a2uiAction: envelope, unrelated: "retained" },
});
const config = { actionTransport: "user-message" as const };
function normalized(value = input()) {
  const result = normalizeA2UIAction(value, config, "native");
  expect(result).not.toBeInstanceOf(Response);
  return result as RunAgentInput;
}

describe("A2UI user-message transport", () => {
  it("preserves the complete envelope as user input without a tool execution claim", () => {
    const original = input();
    const result = normalized(original);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe(
      JSON.stringify({ a2uiAction: envelope }),
    );
    expect(result.threadId).toBe(original.threadId);
    expect(result.runId).toBe(original.runId);
    expect(result.forwardedProps).toEqual({ unrelated: "retained" });
    expect(original.messages).toEqual([]);
    expect(original.forwardedProps.a2uiAction).toBe(envelope);
  });

  it("is idempotent and uses stable, bounded IDs for retries but distinct IDs for clicks", () => {
    const first = normalized();
    expect(normalized()).toEqual(first);
    expect(normalized(first)).toEqual(first);
    expect(
      normalized({ ...input(), runId: "click-2" }).messages[0].id,
    ).not.toBe(first.messages[0].id);
    expect(
      normalized({ ...input(), runId: "😀".repeat(64) }).messages[0].id.length,
    ).toBeLessThan(128);
  });

  it.each([
    undefined,
    {},
    { actionTransport: "tool-call" as const },
    { ...config, enabled: false },
    { ...config, agents: ["other"] },
  ])("preserves legacy, disabled, and out-of-scope inputs: %j", (options) => {
    const original = input();
    expect(normalizeA2UIAction(original, options, "native")).toBe(original);
  });

  it.each([null, [], "invalid"])(
    "rejects malformed action %j",
    (userAction) => {
      const result = normalizeA2UIAction(
        { ...input(), forwardedProps: { a2uiAction: { userAction } } },
        config,
        "native",
      );
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(400);
    },
  );

  it("deduplicates matching retries and rejects conflicting action IDs", () => {
    const first = normalized();
    expect(
      normalized({ ...input(), messages: first.messages }).messages,
    ).toEqual(first.messages);
    const result = normalizeA2UIAction(
      {
        ...input(),
        messages: [
          { id: first.messages[0].id, role: "user", content: "different" },
        ],
      },
      config,
      "native",
    );
    expect((result as Response).status).toBe(400);
  });

  it("does not fabricate a result downstream and retains actual pending answers", async () => {
    const pendingResult = {
      id: "result",
      role: "tool" as const,
      toolCallId: "pending",
      content: "approved",
    };
    const original = { ...input(), messages: [pendingResult] };
    let received: RunAgentInput | undefined;
    class NativeBoundary extends AbstractAgent {
      run(value: RunAgentInput) {
        received = value;
        // Model the native boundary: only the existing pending call can be answered.
        for (const message of value.messages) {
          if (message.role === "tool" && message.toolCallId !== "pending")
            throw new Error("Unsolicited tool result");
        }
        return of(
          {
            type: EventType.RUN_STARTED,
            threadId: value.threadId,
            runId: value.runId,
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: value.threadId,
            runId: value.runId,
          },
        );
      }
    }
    const result = normalized(original);
    await firstValueFrom(
      new A2UIMiddleware().run(result, new NativeBoundary()).pipe(toArray()),
    );
    expect(received?.messages).toEqual([pendingResult, result.messages[1]]);
    expect(received?.messages[1].role).toBe("user");
  });
});
