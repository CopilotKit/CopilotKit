/**
 * Server-side execution of the agent's own tools in `aiSdkAgent`, ported
 * from the classic BuiltInAgent `config-tools-execution.test.ts`. The mock
 * model calls the tools and the real `streamText` runs them.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { defineTool } from "../../agent";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import {
  eventsOfType,
  finishPart,
  modelEmitting,
  modelEmittingTurns,
  offeredToolNames,
  runAgent,
  textParts,
  textTurn,
  toolCallPart,
  toolCallTurn,
} from "./mock-model";

/** A server tool that records its arguments and returns `result`. */
function recordingTool(name: string, result: unknown) {
  const calls: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool.`,
    parameters: z.object({ city: z.string() }),
    execute: async (args) => {
      calls.push(args);
      return result;
    },
  });
  return { tool, calls };
}

/** The tool results the model received on its second call. */
function toolResultsSentBack(model: MockLanguageModelV3) {
  const outputs: unknown[] = [];
  const prompt = model.doStreamCalls[1].prompt;
  for (const message of prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") {
        outputs.push({ toolName: part.toolName, output: part.output });
      }
    }
  }
  return outputs;
}

describe("aiSdkAgent server tools", () => {
  it("offers the tool's description and parameters to the model", async () => {
    const weatherTool = defineTool({
      name: "getWeather",
      description: "Get weather for a city",
      parameters: z.object({
        city: z.string(),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      }),
      execute: async () => ({ temperature: 72 }),
    });
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, tools: [weatherTool] }));

    const offered = model.doStreamCalls[0].tools?.find(
      (tool) => tool.name === "getWeather",
    );
    expect(offered).toMatchObject({
      type: "function",
      description: "Get weather for a city",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
          units: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["city"],
      },
    });
  });

  it("runs the tool with the model's arguments and sends its result back to the model", async () => {
    const weather = recordingTool("getWeather", { weather: "sunny", temp: 72 });
    const model = modelEmittingTurns([
      toolCallTurn("tc-1", "getWeather", { city: "New York" }),
      textTurn("It is sunny."),
    ]);

    await runAgent(aiSdkAgent({ model, tools: [weather.tool], maxSteps: 2 }));

    expect(weather.calls).toEqual([{ city: "New York" }]);
    expect(toolResultsSentBack(model)).toEqual([
      {
        toolName: "getWeather",
        output: { type: "json", value: { weather: "sunny", temp: 72 } },
      },
    ]);
  });

  it("runs each of several tools the model calls in one step", async () => {
    const weather = recordingTool("getWeather", { temp: 72 });
    const search = recordingTool("search", { results: [] });
    const model = modelEmitting([
      toolCallPart("tc-1", "getWeather", { city: "Paris" }),
      toolCallPart("tc-2", "search", { city: "Rome" }),
      finishPart("tool-calls"),
    ]);

    const events = await runAgent(
      aiSdkAgent({ model, tools: [weather.tool, search.tool] }),
    );

    expect(weather.calls).toEqual([{ city: "Paris" }]);
    expect(search.calls).toEqual([{ city: "Rome" }]);
    const results = eventsOfType(events, EventType.TOOL_CALL_RESULT).map(
      (event) => [
        eventField(event, "toolCallId"),
        eventField(event, "content"),
      ],
    );
    expect(results).toEqual(
      expect.arrayContaining([
        ["tc-1", '{"temp":72}'],
        ["tc-2", '{"results":[]}'],
      ]),
    );
  });

  it("runs a server tool but leaves a frontend tool called in the same step to the client", async () => {
    const server = recordingTool("serverTool", { result: "server" });
    const model = modelEmitting([
      toolCallPart("tc-server", "serverTool", { city: "Oslo" }),
      toolCallPart("tc-client", "clientTool", { input: "x" }),
      finishPart("tool-calls"),
    ]);

    const events = await runAgent(aiSdkAgent({ model, tools: [server.tool] }), {
      tools: [
        {
          name: "clientTool",
          description: "Runs on client",
          parameters: {
            type: "object",
            properties: { input: { type: "string" } },
          },
        },
      ],
    });

    expect(server.calls).toEqual([{ city: "Oslo" }]);
    const resultIds = eventsOfType(events, EventType.TOOL_CALL_RESULT).map(
      (event) => eventField(event, "toolCallId"),
    );
    expect(resultIds).toEqual(["tc-server"]);
  });

  it("sends a tool's error as its result instead of failing the run", async () => {
    const failingTool = defineTool({
      name: "failingTool",
      description: "A tool that fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("API unavailable");
      },
    });
    const model = modelEmitting(toolCallTurn("tc-1", "failingTool", {}));

    const events = await runAgent(aiSdkAgent({ model, tools: [failingTool] }));

    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({
        toolCallId: "tc-1",
        content: "Error: API unavailable",
      }),
    ]);
    expect(eventsOfType(events, EventType.RUN_ERROR)).toEqual([]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("offers the state tools next to the agent's tools", async () => {
    const myTool = recordingTool("myTool", {});
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, tools: [myTool.tool] }), {
      state: { value: 1 },
    });

    expect(offeredToolNames(model)).toEqual(
      expect.arrayContaining([
        "myTool",
        "AGUISendStateSnapshot",
        "AGUISendStateDelta",
      ]),
    );
  });

  it("keeps the provider's text message id on each side of a tool step", async () => {
    const myTool = recordingTool("myTool", { result: "ok" });
    const model = modelEmittingTurns([
      [
        { type: "text-start", id: "msg-1" },
        { type: "text-delta", id: "msg-1", delta: "Before " },
        { type: "text-delta", id: "msg-1", delta: "tool" },
        { type: "text-end", id: "msg-1" },
        toolCallPart("call1", "myTool", { city: "Oslo" }),
        finishPart("tool-calls"),
      ],
      [...textParts("After tool", "msg-2"), finishPart("stop")],
    ]);

    const events = await runAgent(
      aiSdkAgent({ model, tools: [myTool.tool], maxSteps: 2 }),
    );

    const chunks = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK).map(
      (event) => [eventField(event, "messageId"), eventField(event, "delta")],
    );
    expect(chunks).toEqual([
      ["msg-1", "Before "],
      ["msg-1", "tool"],
      ["msg-2", "After tool"],
    ]);
  });
});
