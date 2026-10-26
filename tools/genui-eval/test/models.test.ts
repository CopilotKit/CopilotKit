import { generateText, jsonSchema, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import {
  FAKE_JUDGE_REPLY,
  FAKE_PROSE_REPLY,
  createFakeModel,
  fakeReflect,
} from "../src/fake";
import {
  createLanguageModel,
  openRouterFetch,
  requireKey,
} from "../src/models";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

describe("requireKey", () => {
  it("fails before any call when a real model has no key, and lets fakes through", () => {
    expect(() => requireKey(["fake:offline", "openai/gpt-5-mini"], {})).toThrow(
      "OPENROUTER_API_KEY is not set (needed for: openai/gpt-5-mini)",
    );
    expect(() => requireKey(["fake:offline"], {})).not.toThrow();
    expect(() =>
      createLanguageModel({ model: "openai/gpt-5-mini" }, undefined, {}),
    ).toThrow("OPENROUTER_API_KEY is not set");
  });
});

describe("openRouterFetch", () => {
  it("asks for the cost, pins the host, passes the effort, and reports host and cost from the stream", async () => {
    let sent: Record<string, unknown> = {};
    const sse = [
      'data: {"id":"1","provider":"Groq","choices":[{"delta":{"content":"hi"}}]}',
      'data: {"id":"1","provider":"Groq","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1,"cost":0.0012}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const base: typeof fetch = async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(sse, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const reported = new Promise<Record<string, unknown>>((resolve) => {
      const wrapped = openRouterFetch(
        { provider: "groq", params: { reasoningEffort: "low" } },
        (meta) => resolve({ ...meta }),
        base,
      );
      void wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "m", stream: true }),
      }).then((r) => r.text());
    });
    expect(await reported).toEqual({ host: "Groq", costUsd: 0.0012 });
    expect(sent).toMatchObject({
      model: "m",
      usage: { include: true },
      provider: { order: ["groq"], allow_fallbacks: false },
      reasoning: { effort: "low" },
    });
  });
});

describe("fake models", () => {
  it("reply from the fixture of the case and transport, or in prose", async () => {
    const model = createFakeModel("fake:unit", FIXTURES);
    const md = streamText({
      model,
      prompt: "[case:cafes-map] [transport:markdown] Show cafes",
    });
    expect(await md.text).toBe("Hello from the cafes fixture.");
    const other = streamText({
      model,
      prompt: "[case:nope] [transport:markdown] x",
    });
    expect(await other.text).toBe(FAKE_PROSE_REPLY);
  });

  it("make a tool fixture a render_ui call", async () => {
    const model = createFakeModel("fake:unit", FIXTURES);
    const result = streamText({
      model,
      prompt: "[case:cafes-map] [transport:tool] Show cafes",
      tools: {
        render_ui: tool({ inputSchema: jsonSchema({ type: "object" }) }),
      },
    });
    const calls = await result.toolCalls;
    expect(calls[0]?.toolName).toBe("render_ui");
    expect(calls[0]?.input).toMatchObject({ target: "chat" });
  });

  it("give fixed judge scores and a deterministic reflection", async () => {
    const judge = await generateText({
      model: createFakeModel("fake:judge"),
      prompt: "x",
    });
    expect(judge.text).toBe(FAKE_JUDGE_REPLY);
    const spec = { markdown: { rules: ["a", "b", "c"] }, tool: {} };
    const reply = fakeReflect(
      "Spec:\n```json\n" + JSON.stringify(spec) + "\n```",
    );
    expect(JSON.parse(reply).markdown.rules).toEqual(["a", "b"]);
  });
});
