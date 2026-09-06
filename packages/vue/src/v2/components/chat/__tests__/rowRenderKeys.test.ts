import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@ag-ui/core";
import {
  createRowKeyStore,
  pruneRowKeyStore,
  resolveRowRenderKeys,
} from "../rowRenderKeys";

function toolCall(id: string, name = "approve"): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function assistant(id: string, toolCalls?: ToolCall[]): Message {
  return { id, role: "assistant", content: "…", toolCalls } as Message;
}

function user(id: string): Message {
  return { id, role: "user", content: "hi" } as Message;
}

/** The row key a message resolves to for a given list. */
function keyOf(
  store: ReturnType<typeof createRowKeyStore>,
  messages: Message[],
  id: string,
) {
  return resolveRowRenderKeys(store, messages).get(id);
}

describe("resolveRowRenderKeys", () => {
  it("keys by message.id when there are no tool calls, leaving the store empty", () => {
    const store = createRowKeyStore();
    const messages = [user("u1"), assistant("a1")];

    const keys = resolveRowRenderKeys(store, messages);

    expect(keys.get("u1")).toBe("u1");
    expect(keys.get("a1")).toBe("a1");
    // The whole point of the override-table design: unaffected conversations
    // carry no state and behave exactly like plain id keying.
    expect(store.overrides.size).toBe(0);
  });

  it("holds the key steady when a tool call appears on an already-streaming message", () => {
    // Real sequence: TEXT_MESSAGE_START creates the message, TOOL_CALL_START
    // then mutates that SAME message. Deriving the key from the tool call
    // would change it here and remount the row.
    const store = createRowKeyStore();

    const streaming = keyOf(store, [assistant("lc_run--1")], "lc_run--1");
    const withTool = keyOf(
      store,
      [assistant("lc_run--1", [toolCall("call_A")])],
      "lc_run--1",
    );

    expect(streaming).toBe("lc_run--1");
    expect(withTool).toBe("lc_run--1");
  });

  it("holds the key steady when the snapshot re-keys the message id", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [assistant("lc_run--1", [toolCall("call_A")])]);
    const afterRekey = keyOf(
      store,
      [assistant("resp_1", [toolCall("call_A")])],
      "resp_1",
    );

    expect(afterRekey).toBe("lc_run--1");
  });

  it("holds the key steady across the full streaming sequence", () => {
    const store = createRowKeyStore();

    const k1 = keyOf(store, [assistant("lc_run--1")], "lc_run--1");
    const k2 = keyOf(
      store,
      [assistant("lc_run--1", [toolCall("call_A")])],
      "lc_run--1",
    );
    const k3 = keyOf(
      store,
      [assistant("resp_1", [toolCall("call_A")])],
      "resp_1",
    );

    expect(new Set([k1, k2, k3]).size).toBe(1);
  });

  it("resolves through a surviving anchor when tool calls are reordered", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A"), toolCall("call_B")]),
    ]);
    // Snapshot re-keys the message AND presents the tool calls in the other
    // order — anchoring on every tool call (not just the first) survives it.
    const afterRekey = keyOf(
      store,
      [assistant("resp_1", [toolCall("call_B"), toolCall("call_A")])],
      "resp_1",
    );

    expect(afterRekey).toBe("lc_run--1");
  });

  it("keeps a later tool call from stealing an established key", () => {
    const store = createRowKeyStore();

    resolveRowRenderKeys(store, [assistant("lc_run--1", [toolCall("call_A")])]);
    // A second tool call arrives on the same row; call_A already owns the key.
    const keys = resolveRowRenderKeys(store, [
      assistant("lc_run--1", [toolCall("call_A"), toolCall("call_B")]),
    ]);

    expect(keys.get("lc_run--1")).toBe("lc_run--1");
    expect(store.overrides.get("tc:call_B")).toBe("lc_run--1");
  });

  it("falls back to message.id when two messages share a tool-call id", () => {
    const store = createRowKeyStore();
    const messages = [
      assistant("a-1", [toolCall("call_X")]),
      assistant("a-2", [toolCall("call_X")]),
    ];

    const keys = resolveRowRenderKeys(store, messages);

    expect(keys.get("a-1")).toBe("a-1");
    expect(keys.get("a-2")).toBe("a-2");
    expect(new Set(keys.values()).size).toBe(2);
  });

  it("keeps a shared-anchor fallback stable across renders", () => {
    // The loser of a shared anchor must not drift between renders, or it
    // remounts on every update.
    const store = createRowKeyStore();
    const messages = [
      assistant("a-1", [toolCall("call_X")]),
      assistant("a-2", [toolCall("call_X")]),
    ];

    const first = resolveRowRenderKeys(store, messages);
    const second = resolveRowRenderKeys(store, messages);

    expect(second.get("a-1")).toBe(first.get("a-1"));
    expect(second.get("a-2")).toBe(first.get("a-2"));
  });

  it("disambiguates when an override vends a key equal to a later message's id", () => {
    // Pathological: the store vends "ghost" for one row, and another message
    // literally has id "ghost". Keys must still be unique.
    const store = createRowKeyStore();
    resolveRowRenderKeys(store, [assistant("ghost", [toolCall("call_X")])]);

    const keys = resolveRowRenderKeys(store, [
      assistant("live", [toolCall("call_X")]),
      assistant("ghost"),
    ]);

    expect(keys.get("live")).toBe("ghost");
    expect(keys.get("ghost")).not.toBe("ghost");
    expect(new Set(keys.values()).size).toBe(2);
  });

  it("is idempotent, so a repeated or abandoned render yields the same keys", () => {
    const store = createRowKeyStore();
    const messages = [
      assistant("a-1", [toolCall("call_A")]),
      assistant("a-2", [toolCall("call_B")]),
      user("u-1"),
    ];

    const first = resolveRowRenderKeys(store, messages);
    const snapshot = new Map(store.overrides);
    const second = resolveRowRenderKeys(store, messages);

    expect([...second.entries()]).toEqual([...first.entries()]);
    expect([...store.overrides.entries()]).toEqual([...snapshot.entries()]);
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

    expect(keys.get("a-1")).toBe("a-1");
    expect(store.overrides.size).toBe(0);
  });

  it("still re-keys a text-only message (documented limitation)", () => {
    // No anchor exists for a text-only message, so nothing can correlate it
    // across a rename. Recorded so a future change that fixes it is a
    // deliberate update rather than an accident.
    const store = createRowKeyStore();

    const before = keyOf(store, [assistant("lc_run--1")], "lc_run--1");
    const after = keyOf(store, [assistant("resp_1")], "resp_1");

    expect(before).toBe("lc_run--1");
    expect(after).toBe("resp_1");
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

    // The re-key must still resolve after an intervening prune.
    const afterRekey = keyOf(
      store,
      [assistant("resp_1", [toolCall("call_A")])],
      "resp_1",
    );

    expect(afterRekey).toBe("lc_run--1");
  });
});
