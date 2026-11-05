/**
 * Provider message ids must not collide across runs (#3410, #3623). Providers
 * reuse ids such as "txt-0" or an Anthropic content-block index on every
 * run, so the classic agent gives each run's text a fresh UUID instead of
 * the adapter's id. The fake adapter names its text `<runId>-text`.
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  collectEvents,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
} from "./agent-test-helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MESSAGES = [{ id: "1", role: "user" as const, content: "Hi" }];

function textMessageIds(events: BaseEvent[]) {
  return [
    ...new Set(
      eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK).map(
        (e) => e.messageId,
      ),
    ),
  ];
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
});
