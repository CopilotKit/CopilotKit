import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** The reply of a fake model that has no fixture for a case. */
export const FAKE_PROSE_REPLY = "Here is a short answer in plain prose.";

/** About four characters per token, for fake usage numbers. */
const tokensOf = (text: string) => Math.ceil(text.length / 4);

type FakePrompt = Parameters<MockLanguageModelV3["doStream"]>[0]["prompt"];

/** All the text of a prompt, to find the case marker and to count tokens. */
export function promptText(prompt: FakePrompt): string {
  return prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => ("text" in part ? part.text : ""))
            .join(""),
    )
    .join("\n");
}

/**
 * The fixture of a scripted reply. The harness puts the case id and the
 * transport in the user message as `[case:<id>] [transport:<t>]` only for
 * fake models, so the fake knows which reply to give.
 */
export function readFixture(
  script: string,
  prompt: string,
  dir = FIXTURES_DIR,
) {
  const caseId = /\[case:([a-z0-9-]+)\]/.exec(prompt)?.[1];
  const transport = /\[transport:(markdown|tool)\]/.exec(prompt)?.[1];
  if (!caseId || !transport) return undefined;
  const file = `${dir}${script}/${caseId}.${transport}.txt`;
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function usage(prompt: string, output: string) {
  return {
    inputTokens: {
      total: tokensOf(prompt),
      noCache: tokensOf(prompt),
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: tokensOf(output),
      text: tokensOf(output),
      reasoning: undefined,
    },
  };
}

/** The stream of a text reply, in a few deltas. */
function textParts(text: string, prompt: string): LanguageModelV3StreamPart[] {
  const deltas = text.match(/[\s\S]{1,80}/g) ?? [""];
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...deltas.map((delta) => ({
      type: "text-delta" as const,
      id: "t1",
      delta,
    })),
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage(prompt, text),
    },
  ];
}

/** The stream of a render_ui tool call with `args` (a JSON text). */
function toolParts(args: string, prompt: string): LanguageModelV3StreamPart[] {
  const deltas = args.match(/[\s\S]{1,80}/g) ?? [""];
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id: "call-1", toolName: "render_ui" },
    ...deltas.map((delta) => ({
      type: "tool-input-delta" as const,
      id: "call-1",
      delta,
    })),
    { type: "tool-input-end", id: "call-1" },
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "render_ui",
      input: args,
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: usage(prompt, args),
    },
  ];
}

/**
 * A scripted reply for the prompt. A tool fixture is a JSON line
 * `{"target":...,"operations":[...]}` and becomes a render_ui call; any
 * other fixture is the text of the reply. With no fixture, the reply is
 * `FAKE_PROSE_REPLY`.
 */
export function scriptedParts(script: string, prompt: string, dir?: string) {
  const fixture = readFixture(script, prompt, dir);
  if (fixture !== undefined && prompt.includes("[transport:tool]")) {
    const trimmed = fixture.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"operations"')) {
      return toolParts(trimmed, prompt);
    }
  }
  return textParts(fixture ?? FAKE_PROSE_REPLY, prompt);
}

/**
 * Answers a `generateText` call: the judge and the reflection model use
 * these. `answer` gets the prompt text and returns the reply text.
 */
function fakeGenerator(answer: (prompt: string) => string) {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const text = promptText(prompt);
      const reply = answer(text);
      return {
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(text, reply),
        warnings: [],
      };
    },
  });
}

/** The fake judge: fixed scores, so offline runs have judge numbers. */
export const FAKE_JUDGE_REPLY = JSON.stringify({
  judgement: { score: 0.8, reason: "fake judge" },
  quality: { score: 0.7, reason: "fake judge" },
});

/**
 * The fake reflection model: it reads the spec in the prompt (between
 * ```json fences) and drops the last markdown rule, so the optimizer has a
 * real, deterministic candidate to score offline.
 */
export function fakeReflect(prompt: string) {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt);
  if (!match) return "{}";
  const spec = JSON.parse(match[1]) as {
    markdown: { rules: unknown[] };
  };
  spec.markdown.rules = spec.markdown.rules.slice(0, -1);
  return JSON.stringify(spec);
}

/**
 * The offline model of `fake:<script>`. `fake:judge` and `fake:reflect` are
 * the fake judge and reflection model; any other script replies from
 * `fixtures/<script>/<caseId>.<transport>.txt`.
 */
export function createFakeModel(model: string, dir?: string): LanguageModel {
  const script = model.slice("fake:".length);
  if (script === "judge") return fakeGenerator(() => FAKE_JUDGE_REPLY);
  if (script === "reflect") return fakeGenerator(fakeReflect);
  return new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const text = promptText(prompt);
      return {
        stream: simulateReadableStream({
          chunks: scriptedParts(script, text, dir),
        }),
      };
    },
  });
}
