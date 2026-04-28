import { describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import type { RunAgentInput } from "@ag-ui/client";
import type { LanguageModelChat } from "vscode";
import { vscodeLmFactory, type RecordedCall } from "../vscode-lm-factory";

vi.mock("vscode", () => ({
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class {
    constructor(
      public callId: string,
      public name: string,
      public input: unknown,
    ) {}
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
    cancel() {
      this.token.isCancellationRequested = true;
    }
    dispose() {}
  },
  LanguageModelChatMessage: {
    User: (text: string) => ({ role: "user", content: text }),
    Assistant: (text: string) => ({ role: "assistant", content: text }),
  },
}));

function makeModel(streamParts: unknown[]) {
  return {
    id: "test-model",
    family: "test",
    name: "Test",
    vendor: "test",
    sendRequest: vi.fn(async () => ({
      stream: (async function* () {
        for (const p of streamParts) yield p;
      })(),
      text: (async function* () {})(),
    })),
  } as unknown as LanguageModelChat;
}

const minimalInput: RunAgentInput = {
  threadId: "t1",
  runId: "r1",
  state: {},
  messages: [{ id: "m1", role: "user", content: "hello" }],
  tools: [],
  context: [],
  forwardedProps: {},
};

describe("vscodeLmFactory — live mode", () => {
  it("yields TEXT_MESSAGE_CONTENT chunks for each text part", async () => {
    const { LanguageModelTextPart } = await import("vscode");
    const model = makeModel([
      new LanguageModelTextPart("Hello"),
      new LanguageModelTextPart(" world"),
    ]);
    const factory = vscodeLmFactory({ model, mode: "live" });
    const chunks: unknown[] = [];
    for await (const c of factory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { type: "TEXT_MESSAGE_CONTENT", delta: "Hello" },
      { type: "TEXT_MESSAGE_CONTENT", delta: " world" },
    ]);
  });

  it("yields TOOL_CALL_START + ARGS + END for a tool-call part", async () => {
    const { LanguageModelToolCallPart } = await import("vscode");
    const model = makeModel([
      new LanguageModelToolCallPart("call_1", "search", { q: "ag-ui" }),
    ]);
    const factory = vscodeLmFactory({ model, mode: "live" });
    const chunks: unknown[] = [];
    for await (const c of factory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      {
        type: "TOOL_CALL_START",
        toolCallId: "call_1",
        toolCallName: "search",
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "call_1",
        delta: JSON.stringify({ q: "ag-ui" }),
      },
      { type: "TOOL_CALL_END", toolCallId: "call_1" },
    ]);
  });
});

describe("vscodeLmFactory — record mode", () => {
  it("yields chunks AND reports each call to onCallRecorded", async () => {
    const { LanguageModelTextPart } = await import("vscode");
    const model = makeModel([new LanguageModelTextPart("Hi")]);
    const recorded: unknown[] = [];
    const factory = vscodeLmFactory({
      model,
      mode: "record",
      onCallRecorded: (call) => recorded.push(call),
    });
    const chunks: unknown[] = [];
    for await (const c of factory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: "TEXT_MESSAGE_CONTENT", delta: "Hi" }]);
    expect(recorded).toHaveLength(1);
    const [call] = recorded as Array<{ matchKey: string; chunks: unknown[] }>;
    expect(call.matchKey).toMatch(/^[0-9a-f]{64}$/);
    expect(call.chunks).toEqual([
      { type: "TEXT_MESSAGE_CONTENT", delta: "Hi" },
    ]);
  });
});

describe("vscodeLmFactory — replay mode", () => {
  it("yields recorded chunks for a matching matchKey", async () => {
    const { LanguageModelTextPart } = await import("vscode");
    // Record first to compute the matchKey deterministically.
    const recordModel = makeModel([new LanguageModelTextPart("Hi")]);
    let recordedCall: RecordedCall | null = null;
    const recordFactory = vscodeLmFactory({
      model: recordModel,
      mode: "record",
      onCallRecorded: (call) => {
        recordedCall = call;
      },
    });
    for await (const _ of recordFactory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })) {
      void _;
    }
    expect(recordedCall).not.toBeNull();

    // Now replay using a model that would throw if called.
    const replayModel = makeModel([]);
    (
      replayModel.sendRequest as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async () => {
      throw new Error("replay must not call vscode.lm");
    });
    const factory = vscodeLmFactory({
      model: replayModel,
      mode: "replay",
      fixtureCalls: [recordedCall!],
    });
    const chunks: unknown[] = [];
    for await (const c of factory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: "TEXT_MESSAGE_CONTENT", delta: "Hi" }]);
  });

  it("throws when no fixture matches the input", async () => {
    const replayModel = makeModel([]);
    const factory = vscodeLmFactory({
      model: replayModel,
      mode: "replay",
      fixtureCalls: [],
    });
    const iter = factory({
      input: minimalInput,
      abortController: new AbortController(),
      abortSignal: new AbortController().signal,
    })[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(/no fixture call matches/i);
  });

  it("consumes same-key calls in order across multiple iterations", async () => {
    const baseInput = minimalInput;
    // Build matchKey for input by inspecting what record produces.
    const recordModel = makeModel([{ kind: "text", value: "First" } as never]);
    // We can't easily reuse record output here; compute matchKey directly from
    // the same hash function used in implementation by hashing the canonical input.
    const matchKey = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          messages: baseInput.messages,
          tools: baseInput.tools,
          modelId: "test-model",
        }),
      )
      .digest("hex");
    const inputSnapshot = {
      messages: baseInput.messages,
      tools: baseInput.tools,
      modelId: "test-model",
    };
    const calls: RecordedCall[] = [
      {
        matchKey,
        input: inputSnapshot,
        chunks: [{ type: "TEXT_MESSAGE_CONTENT", delta: "A" }],
      },
      {
        matchKey,
        input: inputSnapshot,
        chunks: [{ type: "TEXT_MESSAGE_CONTENT", delta: "B" }],
      },
    ];
    const factory = vscodeLmFactory({
      model: recordModel,
      mode: "replay",
      fixtureCalls: calls,
    });
    const collect = async () => {
      const out: unknown[] = [];
      for await (const c of factory({
        input: baseInput,
        abortController: new AbortController(),
        abortSignal: new AbortController().signal,
      })) {
        out.push(c);
      }
      return out;
    };
    expect(await collect()).toEqual([
      { type: "TEXT_MESSAGE_CONTENT", delta: "A" },
    ]);
    expect(await collect()).toEqual([
      { type: "TEXT_MESSAGE_CONTENT", delta: "B" },
    ]);
    await expect(collect()).rejects.toThrow();
  });
});
