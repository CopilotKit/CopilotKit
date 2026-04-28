import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { vscodeLmFactory } from "../vscode-lm-factory";

// Hoisted mock surface — populated per-test via `setLmStream`.
const sendRequest = vi.fn();
const lmTextPart = vi.fn((value: string) => ({ kind: "text", value }));
const lmToolCallPart = vi.fn(
  (callId: string, name: string, input: unknown) => ({
    kind: "tool-call",
    callId,
    name,
    input,
  }),
);

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

afterEach(() => {
  sendRequest.mockReset();
  lmTextPart.mockClear();
  lmToolCallPart.mockClear();
});

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
  } as unknown as import("vscode").LanguageModelChat;
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
