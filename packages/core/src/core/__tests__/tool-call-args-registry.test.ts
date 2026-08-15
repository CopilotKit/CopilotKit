import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import {
  ToolCallArgsRegistry,
  ToolCallArgsManager,
  normalizeMessagesWithAuthoritativeArgs,
} from "../tool-call-args-registry";

function assistantMessageWithToolCall(
  toolCallId: string,
  args: string,
): Message {
  return {
    id: `msg-${toolCallId}`,
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: toolCallId,
        type: "function" as const,
        function: { name: "select_address", arguments: args },
      },
    ],
  } as Message;
}

describe("ToolCallArgsRegistry", () => {
  it("records and returns fully-formed JSON args", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"postcode":"M1 1AA"}');

    expect(registry.get("call-1")).toBe('{"postcode":"M1 1AA"}');
  });

  it("ignores partial (mid-stream) JSON buffers", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"postcode":"M1 1AA"');

    expect(registry.get("call-1")).toBeUndefined();
  });

  it("overwrites an earlier recording once the buffer is complete", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"postcode":');
    registry.record("call-1", '{"postcode":"M1 1AA","addresses":[]}');

    expect(registry.get("call-1")).toBe(
      '{"postcode":"M1 1AA","addresses":[]}',
    );
  });

  it("clear drops all entries", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", "{}");
    registry.clear();

    expect(registry.get("call-1")).toBeUndefined();
  });
});

describe("normalizeMessagesWithAuthoritativeArgs", () => {
  it("corrects tool call args that regressed from the authoritative value", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record(
      "call-1",
      '{"postcode":"M1 1AA","addresses":[{"id":"6"}]}',
    );
    const regressed = [
      assistantMessageWithToolCall(
        "call-1",
        '{"postcode":"M1 1AA","addresses":[{"id":"1"}]}',
      ),
    ];

    const corrected = normalizeMessagesWithAuthoritativeArgs(
      regressed,
      registry,
    );

    expect(corrected).not.toBeNull();
    expect(corrected![0].toolCalls![0].function.arguments).toBe(
      '{"postcode":"M1 1AA","addresses":[{"id":"6"}]}',
    );
  });

  it("does not mutate the input messages", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"a":2}');
    const original = [assistantMessageWithToolCall("call-1", '{"a":1}')];
    const originalArgs =
      original[0].toolCalls![0].function.arguments;

    normalizeMessagesWithAuthoritativeArgs(original, registry);

    expect(original[0].toolCalls![0].function.arguments).toBe(originalArgs);
    expect(original[0].toolCalls![0].function.arguments).toBe('{"a":1}');
  });

  it("returns null when messages already match the registry", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"a":1}');

    expect(
      normalizeMessagesWithAuthoritativeArgs(
        [assistantMessageWithToolCall("call-1", '{"a":1}')],
        registry,
      ),
    ).toBeNull();
  });

  it("returns null when no tool call is known to the registry", () => {
    const registry = new ToolCallArgsRegistry();

    expect(
      normalizeMessagesWithAuthoritativeArgs(
        [assistantMessageWithToolCall("call-unknown", '{"a":1}')],
        registry,
      ),
    ).toBeNull();
  });

  it("short-circuits on an empty registry without scanning messages", () => {
    const registry = new ToolCallArgsRegistry();
    // Even messages with tool calls are left alone: nothing was ever
    // observed, so there is no authoritative value to correct towards.
    expect(
      normalizeMessagesWithAuthoritativeArgs(
        [assistantMessageWithToolCall("call-1", "not-even-json")],
        registry,
      ),
    ).toBeNull();
  });

  it("leaves messages without tool calls untouched", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"a":1}');
    const messages: Message[] = [
      { id: "m1", role: "user", content: "hi" },
      { id: "m2", role: "assistant", content: "hello" },
    ];

    expect(
      normalizeMessagesWithAuthoritativeArgs(messages, registry),
    ).toBeNull();
  });

  it("corrects multiple regressed tool calls across messages", () => {
    const registry = new ToolCallArgsRegistry();
    registry.record("call-1", '{"v":"authoritative-1"}');
    registry.record("call-2", '{"v":"authoritative-2"}');
    const messages = [
      assistantMessageWithToolCall("call-1", '{"v":"stale-1"}'),
      assistantMessageWithToolCall("call-2", '{"v":"stale-2"}'),
    ];

    const corrected = normalizeMessagesWithAuthoritativeArgs(
      messages,
      registry,
    );

    expect(corrected!.map((m) => m.toolCalls![0].function.arguments)).toEqual([
      '{"v":"authoritative-1"}',
      '{"v":"authoritative-2"}',
    ]);
  });
});

describe("ToolCallArgsManager", () => {
  function createAgentFixture(agentId = "agent-1") {
    const subscribers: Array<Record<string, (params: any) => void>> = [];
    const agent = {
      agentId,
      messages: [] as Message[],
      subscribe(subscriber: Record<string, (params: any) => void>) {
        subscribers.push(subscriber);
        return {
          unsubscribe: () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) subscribers.splice(index, 1);
          },
        };
      },
      setMessages(messages: Message[]) {
        agent.messages = messages;
        for (const subscriber of [...subscribers]) {
          subscriber.onMessagesChanged?.({ messages, agent });
        }
      },
      emitToolCallArgs(toolCallId: string, bufferBeforeDelta: string, delta: string) {
        for (const subscriber of [...subscribers]) {
          subscriber.onToolCallArgsEvent?.({
            event: { toolCallId, delta },
            toolCallBuffer: bufferBeforeDelta,
          });
        }
      },
      emitToolCallEnd(toolCallId: string, toolCallArgs: Record<string, unknown>) {
        for (const subscriber of [...subscribers]) {
          subscriber.onToolCallEndEvent?.({
            event: { toolCallId },
            toolCallArgs,
          });
        }
      },
    };
    return agent;
  }

  it("records args from TOOL_CALL_ARGS events per agent", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();

    manager.subscribeToAgent(agent as any);
    agent.emitToolCallArgs("call-1", "", '{"a":1}');

    expect(
      manager.getAuthoritativeArgs(agent as any, "call-1"),
    ).toBe('{"a":1}');
  });

  it("accumulates consecutive deltas as the pipeline does (buffer excludes the current delta)", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();

    manager.subscribeToAgent(agent as any);
    agent.emitToolCallArgs("call-1", "", '{"postcode":');
    agent.emitToolCallArgs("call-1", '{"postcode":', '"M1 1AA"}');

    expect(
      manager.getAuthoritativeArgs(agent as any, "call-1"),
    ).toBe('{"postcode":"M1 1AA"}');
  });

  it("re-records at TOOL_CALL_END with the pipeline's terminal parsed args", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();

    manager.subscribeToAgent(agent as any);
    agent.emitToolCallArgs("call-1", "", '{"postcode":"M1 1AA"}');
    // END carries the pipeline's own parse of the final buffer — the
    // authoritative completion point, superseding any ARGS-time recording.
    agent.emitToolCallEnd("call-1", {
      postcode: "M1 1AA",
      addresses: [{ id: "6" }],
    });

    expect(
      manager.getAuthoritativeArgs(agent as any, "call-1"),
    ).toBe('{"postcode":"M1 1AA","addresses":[{"id":"6"}]}');
  });

  it("keeps the mid-stream recording when TOOL_CALL_END parses to an empty object", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();

    manager.subscribeToAgent(agent as any);
    agent.emitToolCallArgs("call-1", "", '{"postcode":"M1 1AA"}');
    // Empty object means upstream's JSON.parse of the final buffer failed —
    // not a real terminal value; don't clobber the observed complete args.
    agent.emitToolCallEnd("call-1", {});

    expect(
      manager.getAuthoritativeArgs(agent as any, "call-1"),
    ).toBe('{"postcode":"M1 1AA"}');
  });

  it("re-corrects messages via setMessages when a snapshot regressed args", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();
    manager.subscribeToAgent(agent as any);

    agent.emitToolCallArgs(
      "call-1",
      "",
      '{"postcode":"M1 1AA","addresses":[{"id":"6"}]}',
    );
    // Simulate a MESSAGES_SNAPSHOT carrying the hallucinated LLM args.
    agent.setMessages([
      assistantMessageWithToolCall(
        "call-1",
        '{"postcode":"M1 1AA","addresses":[{"id":"1"}]}',
      ),
    ]);

    expect(agent.messages[0].toolCalls![0].function.arguments).toBe(
      '{"postcode":"M1 1AA","addresses":[{"id":"6"}]}',
    );
  });

  it("does not rewrite messages when args already match", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();
    manager.subscribeToAgent(agent as any);

    const message = assistantMessageWithToolCall("call-1", '{"a":1}');
    let setMessagesCalls = 0;
    const originalSetMessages = agent.setMessages.bind(agent);
    agent.setMessages = (messages: Message[]) => {
      setMessagesCalls++;
      originalSetMessages(messages);
    };

    agent.emitToolCallArgs("call-1", "", '{"a":1}');
    agent.setMessages([message]);

    expect(setMessagesCalls).toBe(1); // only the simulated snapshot, no correction
  });

  it("skips agents without an agentId", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture("");

    manager.subscribeToAgent(agent as any);

    expect(manager.getAuthoritativeArgs(agent as any, "call-1")).toBeUndefined();
  });

  it("drops recorded entries when the same agent is re-subscribed", () => {
    const manager = new ToolCallArgsManager();
    const agent = createAgentFixture();
    manager.subscribeToAgent(agent as any);
    agent.emitToolCallArgs("call-1", "", '{"a":1}');

    manager.subscribeToAgent(agent as any);

    expect(manager.getAuthoritativeArgs(agent as any, "call-1")).toBeUndefined();
  });
});
