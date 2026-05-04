import { describe, expect, it } from "vitest";
import { buildReplayMessages } from "../fixture-replay";
import type { SavedFixture } from "../fixture-store";

const baseMetadata: SavedFixture["metadata"] = {
  name: "test",
  createdAt: "2026-04-23T12:00:00Z",
  modelId: "auto",
  modelVendor: "copilot",
  version: 2,
};

describe("buildReplayMessages", () => {
  it("returns an empty array when the fixture has no recorded calls", () => {
    expect(buildReplayMessages({ metadata: baseMetadata, calls: [] })).toEqual(
      [],
    );
  });

  it("emits user messages from the last call's input plus the reconstructed final assistant turn", () => {
    const fixture: SavedFixture = {
      metadata: baseMetadata,
      calls: [
        {
          matchKey: "k1",
          input: {
            messages: [
              { id: "u1", role: "user", content: "weather in berlin" },
            ],
            tools: [],
            modelId: "auto",
          },
          chunks: [
            { type: "TEXT_MESSAGE_CONTENT", delta: "Sure, " } as any,
            { type: "TEXT_MESSAGE_CONTENT", delta: "here you go." } as any,
          ],
        },
      ],
    };
    const out = buildReplayMessages(fixture);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      role: "user",
      content: "weather in berlin",
    });
    expect(out[1]).toMatchObject({
      role: "assistant",
      content: "Sure, here you go.",
    });
  });

  it("rebuilds tool calls from TOOL_CALL_START + TOOL_CALL_ARGS chunks", () => {
    const fixture: SavedFixture = {
      metadata: baseMetadata,
      calls: [
        {
          matchKey: "k1",
          input: {
            messages: [{ id: "u1", role: "user", content: "show weather" }],
            tools: [],
            modelId: "auto",
          },
          chunks: [
            {
              type: "TOOL_CALL_START",
              toolCallId: "t1",
              toolCallName: "displayCurrentWeather",
            } as any,
            {
              type: "TOOL_CALL_ARGS",
              toolCallId: "t1",
              delta: '{"city":"',
            } as any,
            {
              type: "TOOL_CALL_ARGS",
              toolCallId: "t1",
              delta: 'Berlin"}',
            } as any,
            { type: "TOOL_CALL_END", toolCallId: "t1" } as any,
          ],
        },
      ],
    };
    const out = buildReplayMessages(fixture);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "t1",
          type: "function",
          function: {
            name: "displayCurrentWeather",
            arguments: '{"city":"Berlin"}',
          },
        },
      ],
    });
  });

  it("emits TOOL_CALL_RESULT chunks as separate tool messages", () => {
    const fixture: SavedFixture = {
      metadata: baseMetadata,
      calls: [
        {
          matchKey: "k1",
          input: {
            messages: [{ id: "u1", role: "user", content: "search" }],
            tools: [],
            modelId: "auto",
          },
          chunks: [
            {
              type: "TOOL_CALL_START",
              toolCallId: "t1",
              toolCallName: "fetch_webpage",
            } as any,
            { type: "TOOL_CALL_END", toolCallId: "t1" } as any,
            {
              type: "TOOL_CALL_RESULT",
              toolCallId: "t1",
              content: "<html>…</html>",
            } as any,
          ],
        },
      ],
    };
    const out = buildReplayMessages(fixture);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg).toMatchObject({
      role: "tool",
      toolCallId: "t1",
      content: "<html>…</html>",
    });
  });
});
