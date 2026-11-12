import { afterEach, describe, expect, it, vi } from "vitest";
import { BuiltInAgent } from "../index";
import { collectEvents } from "./test-helpers";

// Uses the real `ai` and `@ai-sdk/openai` packages and records the HTTP request
// body, so it checks what the installed OpenAI provider sends (#8356).
function captureOpenAIRequests(): Record<string, any>[] {
  const bodies: Record<string, any>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ error: { message: "stop", type: "invalid_request" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }),
  );
  return bodies;
}

async function runOnce(agent: BuiltInAgent) {
  await collectEvents(
    agent["run"]({
      threadId: "thread",
      runId: "run",
      messages: [{ id: "user", role: "user", content: "Hello" }],
      tools: [],
      context: [],
      state: {},
    }),
  ).catch(() => undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenAI reasoning effort in the request", () => {
  it.each(["gpt-6-luna", "gpt-6-sol", "gpt-6.1-terra", "gpt-5.2"])(
    "sends reasoning effort for %s on the Responses API",
    async (model) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("COPILOTKIT_OPENAI_API", "responses");
      const bodies = captureOpenAIRequests();

      await runOnce(
        new BuiltInAgent({
          model: `openai/${model}`,
          providerOptions: { openai: { reasoningEffort: "low" } },
        }),
      );

      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].model).toBe(model);
      expect(bodies[0].reasoning).toEqual({ effort: "low" });
    },
  );

  it("sends reasoning effort none for gpt-6-luna on the Responses API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("COPILOTKIT_OPENAI_API", "responses");
    const bodies = captureOpenAIRequests();

    await runOnce(
      new BuiltInAgent({
        model: "openai/gpt-6-luna",
        providerOptions: { openai: { reasoningEffort: "none" } },
      }),
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].reasoning).toEqual({ effort: "none" });
  });

  it("keeps the forced reasoning_effort none for gpt-6-luna on Chat Completions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("COPILOTKIT_OPENAI_API", "chat");
    const bodies = captureOpenAIRequests();

    await runOnce(
      new BuiltInAgent({
        model: "openai/gpt-6-luna",
        providerOptions: { openai: { reasoningEffort: "medium" } },
      }),
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].model).toBe("gpt-6-luna");
    expect(bodies[0].reasoning_effort).toBe("none");
  });

  it("does not send reasoning effort for a non-reasoning model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("COPILOTKIT_OPENAI_API", "responses");
    const bodies = captureOpenAIRequests();

    await runOnce(
      new BuiltInAgent({
        model: "openai/gpt-4.1",
        providerOptions: { openai: { reasoningEffort: "low" } },
      }),
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].reasoning).toBeUndefined();
  });

  // gpt-6 counts as a reasoning model from @ai-sdk/openai 3.0.140 on. The
  // provider then drops sampling settings and sends the system prompt as a
  // developer message, on both OpenAI APIs.
  it.each([
    ["responses", "gpt-6-luna"],
    ["chat", "gpt-6-luna"],
    ["chat", "gpt-6-sol"],
  ])(
    "drops temperature and topP and sends the prompt as developer for %s %s",
    async (api, model) => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("COPILOTKIT_OPENAI_API", api);
      const bodies = captureOpenAIRequests();

      await runOnce(
        new BuiltInAgent({
          model: `openai/${model}`,
          temperature: 0.2,
          topP: 0.5,
          prompt: "SYS",
        }),
      );

      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].temperature).toBeUndefined();
      expect(bodies[0].top_p).toBeUndefined();
      const messages = api === "chat" ? bodies[0].messages : bodies[0].input;
      expect(messages[0].role).toBe("developer");
    },
  );

  it("keeps temperature, topP and the system role for a non-reasoning model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("COPILOTKIT_OPENAI_API", "responses");
    const bodies = captureOpenAIRequests();

    await runOnce(
      new BuiltInAgent({
        model: "openai/gpt-4.1",
        temperature: 0.2,
        topP: 0.5,
        prompt: "SYS",
      }),
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].temperature).toBe(0.2);
    expect(bodies[0].top_p).toBe(0.5);
    expect(bodies[0].input[0].role).toBe("system");
  });
});
