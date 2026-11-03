/**
 * Provider stream ids that repeat across steps and runs (#3410, #3623), ported
 * from the classic BuiltInAgent `provider-id-collision.test.ts`. The mock
 * model sends the ids that real providers send; the real `streamText` passes
 * them through `aiSdkAgent`.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import {
  eventsOfType,
  modelEmitting,
  reasoningParts,
  runAgent,
  textTurn,
} from "./mock-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function firstMessageId(events: BaseEvent[], type: EventType) {
  return eventField(eventsOfType(events, type)[0], "messageId");
}

describe("aiSdkAgent provider message ids", () => {
  it.each([
    { provider: "OpenAI-compatible", id: "txt-0" },
    { provider: "an msg-0 provider", id: "msg-0" },
    { provider: "Google", id: "0" },
  ])("replaces the $provider text id $id with a UUID", async ({ id }) => {
    const model = modelEmitting(textTurn("Hello", id));

    const events = await runAgent(aiSdkAgent({ model }));

    const messageId = firstMessageId(events, EventType.TEXT_MESSAGE_CHUNK);
    expect(messageId).not.toBe(id);
    expect(messageId).toMatch(UUID);
  });

  it('replaces the reasoning id "reasoning-0" with a UUID', async () => {
    const model = modelEmitting([
      ...reasoningParts("Thinking...", "reasoning-0"),
      ...textTurn("Answer", "txt-0"),
    ]);

    const events = await runAgent(aiSdkAgent({ model }));

    const reasoningId = firstMessageId(events, EventType.REASONING_START);
    expect(reasoningId).not.toBe("reasoning-0");
    expect(reasoningId).toMatch(UUID);
  });

  it("does not reuse an Anthropic content-block index across runs", async () => {
    // @ai-sdk/anthropic sets text-start ids to the content-block index, so a
    // reply that starts with a thinking block uses text id "1" on every run.
    const agent = aiSdkAgent({ model: modelEmitting(textTurn("Hello", "1")) });

    const first = firstMessageId(
      await runAgent(agent, { runId: "run-a" }),
      EventType.TEXT_MESSAGE_CHUNK,
    );
    const second = firstMessageId(
      await runAgent(agent, { runId: "run-b" }),
      EventType.TEXT_MESSAGE_CHUNK,
    );

    expect(first).not.toBe("1");
    expect(second).not.toBe("1");
    expect(first).not.toBe(second);
  });

  it("keeps a provider id that is unique", async () => {
    const model = modelEmitting(textTurn("Hello", "custom-msg-id-123"));

    const events = await runAgent(aiSdkAgent({ model }));

    expect(firstMessageId(events, EventType.TEXT_MESSAGE_CHUNK)).toBe(
      "custom-msg-id-123",
    );
  });
});
