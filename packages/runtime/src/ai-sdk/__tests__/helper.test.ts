/**
 * `aiSdk(ctx)` with `ai` resolved to AI SDK v7 at runtime, the newest major
 * in the `^6 || ^7` peer range. `agent.test.ts` runs `aiSdkAgent` on v6.
 *
 * Types stay on v6: a published build reads `ai` types from the consumer's
 * own install, which this repo cannot reproduce for two majors at once. The
 * mock model is v6's `MockLanguageModelV3`, which v7 also runs.
 */
import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type { RunAgentInput } from "@ag-ui/client";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BuiltInAgent, defineTool } from "../../agent";
import type { BuiltInAgentLearnedSkills } from "../../agent";
import {
  collectEvents,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdk } from "../helper";

vi.mock("ai", async () => await import("ai-v7"));

type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const noSkills: BuiltInAgentLearnedSkills = { catalog: "", definitions: [] };

const loadSkillSpec = {
  name: "copilotkit_load_skill",
  description: "Load a skill.",
  parameters: { type: "object", properties: {} },
  execute: async () => "skill body",
};

const showCardTool = {
  name: "showCard",
  description: "Show a card in the UI.",
  parameters: { type: "object", properties: { title: { type: "string" } } },
};

const userMessage = { id: "u1", role: "user", content: "hi" } as const;

function createCtx(
  input: Partial<RunAgentInput> = {},
  learnedSkills = noSkills,
) {
  const ctx: Parameters<typeof aiSdk>[0] = {
    input: createDefaultInput(input),
    abortSignal: new AbortController().signal,
    learnedSkills,
    onRunEnd: () => {},
    describeInterruptTool: () => {},
  };
  return ctx;
}

function modelEmitting(chunks: ModelStreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

function textModel(text: string) {
  return modelEmitting([
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: USAGE,
    },
  ]);
}

async function drain(result: { fullStream: AsyncIterable<unknown> }) {
  for await (const _part of result.fullStream) {
    // Consuming the stream runs the model call.
  }
}

describe("aiSdk system prompt", () => {
  it("puts the skills catalog before the prompt, and keeps the conversation in messages", async () => {
    const ctx = createCtx(
      {
        messages: [userMessage],
        context: [{ description: "User", value: "Ada" }],
      },
      { catalog: "CATALOG", definitions: [] },
    );

    const base = await aiSdk(ctx, { prompt: "Be brief." });

    expect(base.system).toEqual([
      { role: "system", content: "CATALOG" },
      {
        role: "system",
        content: "Be brief.\n## Context from the application\nUser:\nAda\n",
      },
    ]);
    expect(base.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(base.allowSystemInMessages).toBe(false);
  });

  it("sends the system messages as the conversation when there are no messages, and v7 accepts them", async () => {
    const base = await aiSdk(createCtx(), { prompt: "Be brief." });
    const model = textModel("Hello");

    await drain(streamText({ ...base, model }));

    expect(base.system).toBeUndefined();
    expect(base.messages).toEqual([{ role: "system", content: "Be brief." }]);
    expect(model.doStreamCalls[0].prompt).toEqual([
      { role: "system", content: "Be brief." },
    ]);
  });

  it("forwards client system messages that v7 accepts", async () => {
    const ctx = createCtx({
      messages: [
        { id: "s1", role: "system", content: "Client rule." },
        userMessage,
      ],
    });
    const base = await aiSdk(ctx, { forwardSystemMessages: true });
    const model = textModel("Hello");

    await drain(streamText({ ...base, model }));

    expect(model.doStreamCalls[0].prompt[0]).toEqual({
      role: "system",
      content: "Client rule.",
    });
  });
});

describe("aiSdk tools", () => {
  it("merges frontend, state, learned-skills, then user tools", async () => {
    const ctx = createCtx(
      { tools: [showCardTool] },
      { catalog: "CATALOG", definitions: [loadSkillSpec] },
    );
    const lookup = tool({
      description: "Look up a fact.",
      inputSchema: jsonSchema<{ q: string }>({ type: "object" }),
      execute: async () => "fact",
    });

    const base = await aiSdk(ctx, { tools: { lookup } });

    expect(Object.keys(base.tools)).toEqual([
      "showCard",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "copilotkit_load_skill",
      "lookup",
    ]);
  });

  it("lets a user tool replace a frontend tool with the same name", async () => {
    const ctx = createCtx({ tools: [showCardTool] });
    const showCard = tool({
      description: "Server-side card.",
      inputSchema: jsonSchema<{ title: string }>({ type: "object" }),
      execute: async () => "shown",
    });

    const base = await aiSdk(ctx, { tools: { showCard } });

    expect(base.tools.showCard.description).toBe("Server-side card.");
  });

  it("rejects a tool that uses a name reserved for learned skills", async () => {
    const ctx = createCtx({
      tools: [{ ...showCardTool, name: "copilotkit_load_skill" }],
    });

    await expect(aiSdk(ctx)).rejects.toThrow(
      "Tool name is reserved for learned skills: copilotkit_load_skill",
    );
  });

  it("pauses a v7 run on a defineTool interrupt tool", async () => {
    const model = modelEmitting([
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "bookFlight",
        input: JSON.stringify({ destination: "Tokyo" }),
      },
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage: USAGE,
      },
    ]);
    const bookFlight = defineTool({
      name: "bookFlight",
      description: "Book a flight.",
      parameters: toStandardJsonSchema(v.object({ destination: v.string() })),
      interrupt: true,
    });
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: async (ctx) => {
        const base = await aiSdk(ctx, { tools: [bookFlight] });
        return streamText({ ...base, model });
      },
    });

    const events = await collectEvents(
      agent.run(createDefaultInput({ messages: [userMessage] })),
    );

    const finished = events.find(
      (event) => event.type === EventType.RUN_FINISHED,
    );
    expect(eventField(finished!, "outcome")).toMatchObject({
      type: "interrupt",
      interrupts: [{ id: "tc-1", toolCallId: "tc-1" }],
    });
  });
});

describe("aiSdk URL downloads", () => {
  const privateImage = [
    { url: new URL("http://127.0.0.1/a.png"), isUrlSupportedByModel: false },
  ];
  const publicImage = [
    { url: new URL("https://example.com/a.png"), isUrlSupportedByModel: false },
  ];

  it("refuses non-public addresses by default", async () => {
    const base = await aiSdk(createCtx());

    await expect(base.experimental_download(privateImage)).rejects.toThrow(
      "The URL host is not a public address",
    );
  });

  it("downloads nothing with urlDownload: false", async () => {
    const base = await aiSdk(createCtx(), { urlDownload: false });

    await expect(base.experimental_download(publicImage)).rejects.toThrow(
      "Server-side URL download is disabled",
    );
  });

  it("uses a download function as given", async () => {
    const download = async () => [null];

    const base = await aiSdk(createCtx(), { urlDownload: download });

    expect(base.experimental_download).toBe(download);
  });
});
