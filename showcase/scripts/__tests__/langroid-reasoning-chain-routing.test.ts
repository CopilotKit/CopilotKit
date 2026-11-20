import path from "node:path";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  ToolCallResponse,
} from "@copilotkit/aimock";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
// The sidecar loads d4 before d6. A broad d4 "weather" fixture must not
// intercept the flight+weather chip before its dedicated chain starts.
const fixtures = [
  ...loadFixtureFile(path.join(root, "showcase/aimock/d4/langroid/chat.json")),
  ...loadFixtureFile(
    path.join(
      root,
      "showcase/aimock/d6/langroid/tool-rendering-reasoning-chain.json",
    ),
  ),
];
const chip = "Find flights from SFO to JFK and show me the weather there.";

function match(messages: ChatCompletionRequest["messages"], chainTools = true) {
  return matchFixture(fixtures, {
    model: "gpt-6-luna",
    _context: "langroid",
    messages,
    tools: (chainTools
      ? ["get_weather", "search_flights", "get_stock_price", "roll_dice"]
      : ["get_weather", "search_flights"]
    ).map((name) => ({
      type: "function",
      function: { name, parameters: { type: "object", properties: {} } },
    })),
  } as ChatCompletionRequest);
}

describe("Langroid reasoning-chain fixture precedence", () => {
  it("routes the exact flight chip through flights, destination weather, then the answer", () => {
    const messages: ChatCompletionRequest["messages"] = [
      { role: "user", content: chip },
    ];
    const first = match(messages)!.response as ToolCallResponse;
    expect(first.toolCalls[0].name).toBe("search_flights");
    expect(JSON.parse(first.toolCalls[0].arguments as string)).toEqual({
      origin: "SFO",
      destination: "JFK",
    });
    messages.push({
      role: "tool",
      tool_call_id: first.toolCalls[0].id!,
      content: '{"origin":"SFO","destination":"JFK","flights":[]}',
    });
    const second = match(messages)!.response as ToolCallResponse;
    expect(second.toolCalls[0].name).toBe("get_weather");
    expect(JSON.parse(second.toolCalls[0].arguments as string)).toEqual({
      location: "JFK",
    });
    messages.push({
      role: "tool",
      tool_call_id: second.toolCalls[0].id!,
      content: '{"city":"JFK","temperature":68}',
    });
    expect(match(messages)!.response).toMatchObject({
      content: expect.stringContaining("Three flights from SFO to JFK"),
    });
  });

  it("keeps the generic weather fixture for ordinary chat", () => {
    const fixture = match([
      { role: "user", content: "What is the weather in Tokyo?" },
    ]);
    expect((fixture!.response as ToolCallResponse).toolCalls[0]).toMatchObject({
      id: "call_fp_get_weather_001",
      name: "get_weather",
      arguments: '{"location":"Tokyo"}',
    });
  });

  it("does not send chain flight arguments to the ordinary chat flight tool", () => {
    const fixture = match([{ role: "user", content: chip }], false);
    expect((fixture!.response as ToolCallResponse).toolCalls[0]).toMatchObject({
      id: "call_fp_get_weather_001",
      name: "get_weather",
      arguments: '{"location":"Tokyo"}',
    });
  });
});
