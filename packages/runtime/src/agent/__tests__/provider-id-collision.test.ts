/**
 * Provider message ids must not collide across runs (#3410, #3623). Providers
 * reuse ids such as "txt-0" or an Anthropic content-block index on every
 * run, so the classic agent gives each text message a fresh UUID instead of
 * the adapter's id. The fake adapter names its text `<runId>-text`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { defineTool } from "../index";
import {
  collectEvents,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  runClassicAgent,
} from "./agent-test-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MESSAGES = [{ id: "1", role: "user" as const, content: "Hi" }];

/** The run's text messages in stream order, each with its joined text. */
function textMessages(events: BaseEvent[]) {
  const messages = new Map<string, string>();
  for (const chunk of eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)) {
    const id = chunk.messageId ?? "";
    messages.set(id, (messages.get(id) ?? "") + (chunk.delta ?? ""));
  }
  return [...messages].map(([messageId, text]) => ({ messageId, text }));
}

function textMessageIds(events: BaseEvent[]) {
  return textMessages(events).map((message) => message.messageId);
}

describe("Provider ID collision (#3410, #3623)", () => {
  it("gives the run's text a UUID instead of the adapter's message id", async () => {
    const { agent } = createClassicAgent({}, [{ text: "Hello" }]);

    const events = await collectEvents(
      agent.run(createDefaultInput({ messages: MESSAGES })),
    );

    const [messageId, ...others] = textMessageIds(events);
    expect(others).toEqual([]);
    expect(messageId).toMatch(UUID);
  });

  it("does not reuse a text message id across runs of the same agent", async () => {
    const { agent } = createClassicAgent({}, [
      { thinking: "Thinking...", text: "Hello" },
      { thinking: "Thinking...", text: "Hello" },
    ]);
    const runOnce = async (runId: string) =>
      textMessageIds(
        await collectEvents(
          agent.run(createDefaultInput({ runId, messages: MESSAGES })),
        ),
      )[0];

    const first = await runOnce("run-5a");
    const second = await runOnce("run-5b");

    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });

  describe("Message ID Generation", () => {
    it("starts a new message for the text after a tool call, and parents the call on the text before it", async () => {
      const myTool = defineTool({
        name: "myTool",
        description: "My tool",
        parameters: z.object({}),
        execute: async () => ({ result: "ok" }),
      });

      const { events } = await runClassicAgent(
        { tools: [myTool], maxSteps: 2 },
        [
          {
            text: "Before tool",
            toolCalls: [{ id: "call1", name: "myTool", input: {} }],
          },
          { text: "After tool" },
        ],
        { messages: MESSAGES },
      );

      const [before, after] = textMessages(events);
      expect(textMessages(events)).toEqual([
        { messageId: expect.stringMatching(UUID), text: "Before tool" },
        { messageId: expect.stringMatching(UUID), text: "After tool" },
      ]);
      expect(after?.messageId).not.toBe(before?.messageId);
      expect(eventsOfType(events, EventType.TOOL_CALL_START)).toEqual([
        expect.objectContaining({
          toolCallId: "call1",
          parentMessageId: before?.messageId,
        }),
      ]);
    });
  });
});
