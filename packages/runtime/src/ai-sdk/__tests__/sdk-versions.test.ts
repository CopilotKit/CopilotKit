/**
 * `aiSdkAgent` end to end on both majors of the `ai` peer range (`^6 || ^7`):
 * the same runs against AI SDK v6 and against v7 (the `ai-v7` dev alias).
 *
 * The v6 agent is imported normally. The v7 agent is the same module loaded
 * a second time, after `ai` is mocked to `ai-v7`. Types stay on v6, and the
 * mock model is v6's `MockLanguageModelV3`, which v7 also runs (see
 * helper.test.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import * as aiV6 from "ai";
import { z } from "zod";
import { defineTool } from "../../agent";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent as aiSdkAgentV6 } from "../agent";
import {
  eventsOfType,
  modelEmitting,
  runAgent,
  textTurn,
  toolCallTurn,
} from "./mock-model";

vi.doMock("ai", () => import("ai-v7"));
vi.resetModules();
const aiV7 = await import("ai");
const { aiSdkAgent: aiSdkAgentV7 } = await import("../agent");

const versions = [
  { version: "v6", aiSdkAgent: aiSdkAgentV6 },
  { version: "v7", aiSdkAgent: aiSdkAgentV7 },
];

describe("the v7 agent", () => {
  // Control: the v7 runs below would prove nothing if the module were not
  // loaded again, or if `ai` still resolved to v6 there.
  // `ToolChoiceViolationError` exists only in v7.
  it("is a second copy of the module that loads AI SDK v7", () => {
    expect(aiSdkAgentV7).not.toBe(aiSdkAgentV6);
    expect("ToolChoiceViolationError" in aiV7).toBe(true);
    expect("ToolChoiceViolationError" in aiV6).toBe(false);
  });
});

describe.each(versions)("aiSdkAgent on AI SDK $version", ({ aiSdkAgent }) => {
  it("streams the model's text", async () => {
    const agent = aiSdkAgent({ model: modelEmitting(textTurn("Hello there")) });

    const events = await runAgent(agent);

    const deltas = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK).map(
      (event) => eventField(event, "delta"),
    );
    expect(deltas).toEqual(["Hello there"]);
  });

  it("runs a server tool the model calls and streams its result", async () => {
    const getWeather = defineTool({
      name: "getWeather",
      description: "Weather for a city.",
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temperature: 20 }),
    });
    const agent = aiSdkAgent({
      model: modelEmitting(
        toolCallTurn("tc-1", "getWeather", { city: "Paris" }),
      ),
      tools: [getWeather],
    });

    const events = await runAgent(agent);

    const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
    expect(eventField(result, "content")).toBe(
      '{"city":"Paris","temperature":20}',
    );
  });

  it("turns an AGUISendStateSnapshot call into STATE_SNAPSHOT", async () => {
    const agent = aiSdkAgent({
      model: modelEmitting(
        toolCallTurn("tc-1", "AGUISendStateSnapshot", {
          snapshot: { count: 2 },
        }),
      ),
    });

    const events = await runAgent(agent, { state: { count: 1 } });

    const snapshot = eventsOfType(events, EventType.STATE_SNAPSHOT)[0];
    expect(eventField(snapshot, "snapshot")).toEqual({ count: 2 });
  });

  it("pauses the run on an interrupt tool, without running it", async () => {
    const bookFlight = defineTool({
      name: "bookFlight",
      description: "Book a flight.",
      parameters: z.object({ destination: z.string() }),
      interrupt: true,
      interruptReason: "confirm_booking",
      interruptMessage: "Book it?",
    });
    const agent = aiSdkAgent({
      model: modelEmitting(
        toolCallTurn("tc-1", "bookFlight", { destination: "Tokyo" }),
      ),
      tools: [bookFlight],
    });

    const events = await runAgent(agent);

    const finished = eventsOfType(events, EventType.RUN_FINISHED)[0];
    expect(eventField(finished, "outcome")).toEqual({
      type: "interrupt",
      interrupts: [
        {
          id: "tc-1",
          toolCallId: "tc-1",
          reason: "confirm_booking",
          message: "Book it?",
          metadata: { toolName: "bookFlight" },
        },
      ],
    });
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([]);
  });
});
