import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@ag-ui/core";
import {
  createRowKeyStore,
  pruneRowKeyStore,
  resolveRowRenderKeys,
} from "../row-render-keys";

function toolCall(id: string, name = "approve"): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function assistant(id: string, toolCalls?: ToolCall[]): Message {
  return { id, role: "assistant", content: "…", toolCalls } as Message;
}

function user(id: string): Message {
  return { id, role: "user", content: "hi" } as Message;
}

describe("resolveRowRenderKeys", () => {
  it("tracks by message.id when there are no tool calls, leaving the store empty", () => {
    const store = createRowKeyStore();

    const keys = resolveRowRenderKeys(store, [user("u1"), assistant("a1")]);

    expect(keys).toEqual(["u1", "a1"]);
    // Unaffected conversations carry no state and behave exactly like plain id
    // tracking.
    expect(store.overrides.size).toBe(0);
  });

  it("holds the key steady when a tool call appears on an already-streaming message", () => {
    // TOOL_CALL_START mutates the SAME message that TEXT_MESSAGE_START created.
    // Deriving the key from the tool call would change it here and recreate the
    // row.
    const store = createRowKeyStore();

    const streaming = resolveRowRenderKeys(store, [assistant("lc_run--1")]);
    const withTool = resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A")]),
    ]);

    expect(streaming).toEqual(["lc_run--1"]);
    expect(withTool).toEqual(["lc_run--1"]);
  });

  it("holds the key steady when the snapshot re-keys the message id", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [assistant("lc_run--1", [toolCall("call_A")])]);
    const afterRekey = resolveRowRenderKeys(store, [
      assistant("resp_1", [toolCall("call_A")]),
    ]);

    expect(afterRekey).toEqual(["lc_run--1"]);
  });

  it("holds the key steady across the full streaming sequence", () => {
    const store = createRowKeyStore();

    const k1 = resolveRowRenderKeys(store, [assistant("lc_run--1")])[0];
    const k2 = resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A")]),
    ])[0];
    const k3 = resolveRowRenderKeys(store, [
      assistant("resp_1", [toolCall("call_A")]),
    ])[0];

    expect(new Set([k1, k2, k3]).size).toBe(1);
  });

  it("resolves through a surviving anchor when tool calls are reordered", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A"), toolCall("call_B")]),
    ]);
    const afterRekey = resolveRowRenderKeys(store, [
      assistant("resp_1", [toolCall("call_B"), toolCall("call_A")]),
    ]);

    expect(afterRekey).toEqual(["lc_run--1"]);
  });

  it("keeps a later tool call from stealing an established key", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [assistant("lc_run--1", [toolCall("call_A")])]);
    const keys = resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A"), toolCall("call_B")]),
    ]);

    expect(keys).toEqual(["lc_run--1"]);
    expect(store.overrides.get("tc:call_B")).toBe("lc_run--1");
  });

  it("falls back to message.id when two messages share a tool-call id", () => {
    const store = createRowKeyStore();

    const keys = resolveRowRenderKeys(store, [
      assistant("a-1", [toolCall("call_X")]),
      assistant("a-2", [toolCall("call_X")]),
    ]);

    expect(keys).toEqual(["a-1", "a-2"]);
  });

  it("keeps a shared-anchor fallback stable across renders", () => {
    const store = createRowKeyStore();
    const messages = [
      assistant("a-1", [toolCall("call_X")]),
      assistant("a-2", [toolCall("call_X")]),
    ];

    const first = resolveRowRenderKeys(store, messages);
    const second = resolveRowRenderKeys(store, messages);

    expect(second).toEqual(first);
  });

  it("keeps keys unique when the list contains duplicate message ids", () => {
    // This component does not deduplicate, so duplicate ids reach the template.
    // Angular reports duplicated track values as an error, so uniqueness has to
    // be structural.
    const store = createRowKeyStore();

    const keys = resolveRowRenderKeys(store, [
      assistant("dup"),
      assistant("dup"),
      assistant("dup"),
    ]);

    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe("dup");
  });

  it("disambiguates when an override vends a key equal to a later message's id", () => {
    const store = createRowKeyStore();
    resolveRowRenderKeys(store, [assistant("ghost", [toolCall("call_X")])]);

    const keys = resolveRowRenderKeys(store, [
      assistant("live", [toolCall("call_X")]),
      assistant("ghost"),
    ]);

    expect(keys[0]).toBe("ghost");
    expect(keys[1]).not.toBe("ghost");
    expect(new Set(keys).size).toBe(2);
  });

  it("is idempotent, so a re-evaluated computed yields the same keys", () => {
    const store = createRowKeyStore();
    const messages = [
      assistant("a-1", [toolCall("call_A")]),
      assistant("a-2", [toolCall("call_B")]),
      user("u-1"),
    ];

    const first = resolveRowRenderKeys(store, messages);
    const snapshot = new Map(store.overrides);
    const second = resolveRowRenderKeys(store, messages);

    expect(second).toEqual(first);
    expect([...store.overrides.entries()]).toEqual([...snapshot.entries()]);
  });

  it("preserves the previous index fallback for a message with no id", () => {
    const store = createRowKeyStore();
    const idless = { role: "assistant", content: "x" } as unknown as Message;

    const keys = resolveRowRenderKeys(store, [assistant("a-1"), idless]);

    expect(keys).toEqual(["a-1", "index-1"]);
  });

  it("tolerates a sparse list without throwing", () => {
    const store = createRowKeyStore();

    const keys = resolveRowRenderKeys(store, [undefined, assistant("a-1")]);

    expect(keys[0]).toBe("index-0");
    expect(keys[1]).toBe("a-1");
  });

  it("does not register anchors for non-assistant roles", () => {
    const store = createRowKeyStore();
    const toolMessage = {
      id: "t-1",
      role: "tool",
      content: "ok",
      toolCallId: "call_A",
    } as unknown as Message;

    resolveRowRenderKeys(store, [toolMessage]);

    expect(store.overrides.size).toBe(0);
  });

  it("ignores an empty toolCalls array", () => {
    const store = createRowKeyStore();

    const keys = resolveRowRenderKeys(store, [assistant("a-1", [])]);

    expect(keys).toEqual(["a-1"]);
    expect(store.overrides.size).toBe(0);
  });

  it("still re-keys a text-only message (documented limitation)", () => {
    // No anchor exists for a text-only message, so nothing can correlate it
    // across a rename. Recorded so a future change that fixes it is deliberate.
    const store = createRowKeyStore();

    const before = resolveRowRenderKeys(store, [assistant("lc_run--1")]);
    const after = resolveRowRenderKeys(store, [assistant("resp_1")]);

    expect(before).toEqual(["lc_run--1"]);
    expect(after).toEqual(["resp_1"]);
  });
});

describe("pruneRowKeyStore", () => {
  it("drops anchors whose messages are gone and keeps live ones", () => {
    const store = createRowKeyStore();
    resolveRowRenderKeys(store, [
      assistant("a-1", [toolCall("call_A")]),
      assistant("a-2", [toolCall("call_B")]),
    ]);
    expect(store.overrides.size).toBe(2);

    pruneRowKeyStore(store, [assistant("a-2", [toolCall("call_B")])]);

    expect([...store.overrides.keys()]).toEqual(["tc:call_B"]);
  });

  it("bounds the store to the visible list rather than the conversation", () => {
    const store = createRowKeyStore();
    for (let i = 0; i < 50; i++) {
      const live = [assistant(`a-${i}`, [toolCall(`call_${i}`)])];
      resolveRowRenderKeys(store, live);
      pruneRowKeyStore(store, live);
    }

    expect(store.overrides.size).toBe(1);
  });

  it("preserves the key of a row that survives a prune", () => {
    const store = createRowKeyStore();
    const live = [assistant("lc_run--1", [toolCall("call_A")])];
    resolveRowRenderKeys(store, live);
    pruneRowKeyStore(store, live);

    const afterRekey = resolveRowRenderKeys(store, [
      assistant("resp_1", [toolCall("call_A")]),
    ]);

    expect(afterRekey).toEqual(["lc_run--1"]);
  });
});
