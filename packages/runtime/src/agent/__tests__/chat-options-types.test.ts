import { expectTypeOf, it } from "vitest";
import { createChatOptions } from "@tanstack/ai";
import type { ChatMiddlewareContext } from "@tanstack/ai";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { webSearchTool } from "@tanstack/ai-openai/tools";
import { BuiltInAgent } from "../index";
import type { BuiltInAgentClassicConfig } from "../index";

// The package type check compiles these tests. None of the agents runs a
// model, so the adapters get a placeholder API key.
const gpt52 = createOpenaiChat("gpt-5.2", "test-key");
const codex = createOpenaiChat("gpt-5.1-codex", "test-key");
const search = webSearchTool({ type: "web_search" });

it("infers the adapter type from model", () => {
  const agent = new BuiltInAgent({ model: gpt52 });

  expectTypeOf(agent).toEqualTypeOf<BuiltInAgent<typeof gpt52, unknown>>();
});

it("infers the context type into the middleware hooks", () => {
  const agent = new BuiltInAgent({
    model: gpt52,
    context: { service: "billing" },
    middleware: [
      {
        onUsage(ctx) {
          expectTypeOf(ctx).toEqualTypeOf<
            ChatMiddlewareContext<{ service: string }>
          >();
          expectTypeOf(ctx.context.service).toEqualTypeOf<string>();
        },
      },
    ],
  });

  expectTypeOf(agent).toEqualTypeOf<
    BuiltInAgent<typeof gpt52, { service: string }>
  >();
});

it("accepts the OpenAI provider options, a supported reasoning level, and a provider tool the model has", () => {
  const config: BuiltInAgentClassicConfig<typeof gpt52> = {
    model: gpt52,
    modelOptions: { text: { verbosity: "low" } },
    reasoning: { level: "high", summary: true },
    tools: [search],
    promptCache: "long",
    retry: { maxRetries: 3 },
  };

  expectTypeOf(config.reasoning).not.toBeNever();
});

it("rejects a key that is not an OpenAI provider option", () => {
  void new BuiltInAgent({
    model: gpt52,
    // @ts-expect-error `topK` is not an OpenAI provider option.
    modelOptions: { topK: 40 },
  });
});

it("rejects a reasoning level the model does not have", () => {
  // @ts-expect-error gpt-5.2 has no "minimal" level.
  void new BuiltInAgent({ model: gpt52, reasoning: "minimal" });
});

it("rejects a provider tool the model does not support", () => {
  // @ts-expect-error gpt-5.1-codex has no web search.
  void new BuiltInAgent({ model: codex, tools: [search] });
});

it("rejects the agent-owned chat() keys", () => {
  // @ts-expect-error the agent sets the messages.
  void new BuiltInAgent({ model: gpt52, messages: [] });
  // @ts-expect-error the agent sets the thread id.
  void new BuiltInAgent({ model: gpt52, threadId: "thread" });
  // @ts-expect-error the agent always streams.
  void new BuiltInAgent({ model: gpt52, stream: false });
  void new BuiltInAgent({
    model: gpt52,
    // @ts-expect-error the agent owns the abort controller.
    abortController: new AbortController(),
  });
  // @ts-expect-error the agent takes the model as `model`.
  void new BuiltInAgent({ model: gpt52, adapter: gpt52 });
  // @ts-expect-error interrupts are not part of the classic config.
  void new BuiltInAgent({ model: gpt52, interrupts: [] });
});

it("accepts createChatOptions() output from resolveModel", () => {
  void new BuiltInAgent({
    model: gpt52,
    overridableProperties: ["model"],
    resolveModel: (name) =>
      name === "deep"
        ? createChatOptions({
            adapter: createOpenaiChat("gpt-5-mini", "test-key"),
            reasoning: "high",
            modelOptions: { text: { verbosity: "high" } },
          })
        : createOpenaiChat("gpt-5-nano", "test-key"),
  });
});
