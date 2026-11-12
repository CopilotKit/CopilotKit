/**
 * Classic BuiltInAgent on TanStack AI: the real `chat()` runs against a
 * scripted fake model (`fakeText()` from `@tanstack/ai/testing`), so these
 * tests pin what the agent sends to the model and the AG-UI events it emits.
 * The stream conversion rules themselves (reasoning lifecycle, tool call
 * de-duplication, state events) are pinned in converter-tanstack.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { RENDER_A2UI_TOOL } from "@ag-ui/a2ui-middleware";
import { BuiltInAgent, defineTool } from "../index";
import {
  collectEventsIncludingErrors,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

const USER_HELLO: RunAgentInput["messages"] = [
  { id: "user1", role: "user", content: "Hello" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The text the run streamed, joined from its TEXT_MESSAGE_CHUNK deltas. */
function streamedText(events: BaseEvent[]) {
  return eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
    .map((event) => event.delta ?? "")
    .join("");
}

/** A config tool that records the arguments it was called with. */
function recordingTool() {
  const calls: unknown[] = [];
  const tool = defineTool({
    name: "lookup",
    description: "Look something up",
    parameters: z.object({ query: z.string(), limit: z.number().default(5) }),
    execute: async (args) => {
      calls.push(args);
      return { found: args.query };
    },
  });
  return { tool, calls };
}

/** Runs the agent and also returns the first model request. */
async function firstRequest(
  config: Parameters<typeof runClassicAgent>[0],
  input?: Partial<RunAgentInput>,
) {
  const { requests } = await runClassicAgent(config, [{}], {
    messages: USER_HELLO,
    ...input,
  });
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

describe("BuiltInAgent (classic)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Basic Event Emission", () => {
    it("wraps the run in RUN_STARTED (with its protocol version) and RUN_FINISHED", async () => {
      const { events } = await runClassicAgent({}, [{ text: "Hello" }], {
        threadId: "thread1",
        runId: "run1",
      });

      expect(events[0]).toMatchObject({
        type: EventType.RUN_STARTED,
        threadId: "thread1",
        runId: "run1",
        protocolVersion: "1.0",
      });
      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_FINISHED,
        threadId: "thread1",
        runId: "run1",
      });
      expect(events.at(-1)).not.toHaveProperty("outcome");
    });

    it("streams the model's text as assistant TEXT_MESSAGE_CHUNK events with one generated messageId", async () => {
      const { events } = await runClassicAgent({}, [{ text: "Hello world" }]);

      const chunks = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK);
      expect(streamedText(events)).toBe("Hello world");
      const ids = new Set(chunks.map((e) => e.messageId));
      expect(ids.size).toBe(1);
      expect([...ids][0]).toMatch(UUID);
      for (const chunk of chunks) {
        expect(chunk).toMatchObject({ role: "assistant" });
      }
    });

    it("reports the model's token usage on RUN_FINISHED", async () => {
      // The fake model counts ceil(characters / 4) tokens: the request
      // "user:Hello" is 3 tokens, the answer "Hi there" is 2.
      const { events } = await runClassicAgent({}, [{ text: "Hi there" }], {
        messages: USER_HELLO,
      });

      expect(eventsOfType(events, EventType.RUN_FINISHED)[0]?.usage).toEqual([
        expect.objectContaining({
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        }),
      ]);
    });
  });

  describe("Tool Call Events", () => {
    it("runs a config tool and emits its call lifecycle and JSON result", async () => {
      const { tool, calls } = recordingTool();
      const { events } = await runClassicAgent({ tools: [tool] }, [
        {
          toolCalls: [
            { id: "call1", name: "lookup", input: { query: "cats" } },
          ],
        },
      ]);

      expect(calls).toEqual([{ query: "cats", limit: 5 }]);
      expect(eventsOfType(events, EventType.TOOL_CALL_START)).toEqual([
        expect.objectContaining({
          toolCallId: "call1",
          toolCallName: "lookup",
        }),
      ]);
      expect(
        eventsOfType(events, EventType.TOOL_CALL_ARGS)
          .map((e) => e.delta)
          .join(""),
      ).toBe('{"query":"cats"}');
      expect(eventsOfType(events, EventType.TOOL_CALL_END)).toEqual([
        expect.objectContaining({ toolCallId: "call1" }),
      ]);
      expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call1",
          content: '{"found":"cats"}',
        }),
      ]);
    });

    it("emits a visible tool result when execution throws", async () => {
      const getCats = defineTool({
        name: "getCats",
        description: "Get cats",
        parameters: z.object({ limit: z.number() }),
        execute: async () => {
          throw new Error("Missing API key");
        },
      });
      const { events } = await runClassicAgent({ tools: [getCats] }, [
        {
          toolCalls: [
            { id: "call-error", name: "getCats", input: { limit: 1 } },
          ],
        },
      ]);

      expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
        expect.objectContaining({
          toolCallId: "call-error",
          content: "Error: Missing API key",
        }),
      ]);
      expect(eventsOfType(events, EventType.RUN_ERROR)).toHaveLength(0);
      expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    });

    it("answers arguments that fail the tool's schema with an Error result instead of running the tool", async () => {
      const { tool, calls } = recordingTool();
      const { events } = await runClassicAgent({ tools: [tool] }, [
        { toolCalls: [{ id: "call1", name: "lookup", input: { query: 42 } }] },
      ]);

      expect(calls).toEqual([]);
      const [result] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
      expect(result?.content).toMatch(
        /^Error: Input validation failed for tool lookup/,
      );
    });
  });

  describe("maxSteps", () => {
    const loop = [
      { toolCalls: [{ id: "call1", name: "lookup", input: { query: "a" } }] },
      { text: "Done" },
    ];

    it("makes one model call by default and still runs the tools it asked for", async () => {
      const { tool, calls } = recordingTool();
      const { events, requests } = await runClassicAgent(
        { tools: [tool] },
        loop,
      );

      expect(requests).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(streamedText(events)).toBe("");
    });

    it("lets the model answer the tool result when maxSteps allows another call", async () => {
      const { tool } = recordingTool();
      const { events, requests } = await runClassicAgent(
        { tools: [tool], maxSteps: 2 },
        loop,
      );

      expect(requests).toHaveLength(2);
      expect(requests[1]!.messages.at(-1)).toMatchObject({
        role: "tool",
        toolCallId: "call1",
        content: '{"found":"a"}',
      });
      expect(streamedText(events)).toBe("Done");
    });
  });

  describe("Prompt Building", () => {
    it("sends no system prompt when there is no prompt, context, or state", async () => {
      const request = await firstRequest({});

      expect(request.systemPrompts).toEqual([]);
      expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("sends the config prompt as a system prompt, not as a message", async () => {
      const request = await firstRequest({
        prompt: "You are a helpful assistant.",
      });

      expect(request.systemPrompts).toEqual(["You are a helpful assistant."]);
      expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("adds the context under its classic heading", async () => {
      const request = await firstRequest(
        {},
        {
          context: [
            { description: "User Name", value: "John Doe" },
            { description: "Location", value: "New York" },
          ],
        },
      );

      expect(request.systemPrompts).toEqual([
        "\n## Context from the application\nUser Name:\nJohn Doe\nLocation:\nNew York\n",
      ]);
    });

    it("adds the state with the hint that the state tools can edit it", async () => {
      const request = await firstRequest({}, { state: { counter: 0 } });

      expect(request.systemPrompts).toEqual([
        "\n## Application State\n" +
          "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
          '```json\n{\n  "counter": 0\n}\n```\n',
      ]);
    });

    it("joins prompt, context, and state into one system prompt, in that order", async () => {
      const request = await firstRequest(
        { prompt: "You are helpful." },
        {
          context: [{ description: "Context", value: "Data" }],
          state: { value: 1 },
        },
      );

      expect(request.systemPrompts).toHaveLength(1);
      const prompt = String(request.systemPrompts![0]);
      expect(prompt.startsWith("You are helpful.")).toBe(true);
      expect(prompt.indexOf("Context from the application")).toBeLessThan(
        prompt.indexOf("Application State"),
      );
    });

    it("uses a forwarded prompt only when prompt is overridable", async () => {
      const forwardedProps = { prompt: "Forwarded prompt" };

      const locked = await firstRequest(
        { prompt: "Configured prompt" },
        { forwardedProps },
      );
      const open = await firstRequest(
        { prompt: "Configured prompt", overridableProperties: ["prompt"] },
        { forwardedProps },
      );

      expect(locked.systemPrompts).toEqual(["Configured prompt"]);
      expect(open.systemPrompts).toEqual(["Forwarded prompt"]);
    });
  });

  describe("Forward System/Developer Messages", () => {
    const messages: RunAgentInput["messages"] = [
      { id: "sys1", role: "system", content: "System instruction" },
      { id: "dev1", role: "developer", content: "Developer hint" },
      { id: "user1", role: "user", content: "Hello" },
    ];

    it("drops system and developer messages by default", async () => {
      const request = await firstRequest({}, { messages });

      expect(request.systemPrompts).toEqual([]);
      expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it.each([
      [{ forwardSystemMessages: true }, ["System instruction"]],
      [{ forwardDeveloperMessages: true }, ["Developer hint"]],
      [
        { forwardSystemMessages: true, forwardDeveloperMessages: true },
        ["System instruction", "Developer hint"],
      ],
    ])(
      "forwards the enabled roles as system prompts (%o)",
      async (flags, expected) => {
        const request = await firstRequest(flags, { messages });

        expect(request.systemPrompts).toEqual(expected);
        expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
      },
    );

    it("places the config prompt before forwarded messages", async () => {
      const request = await firstRequest(
        {
          prompt: "You are a helpful assistant.",
          forwardSystemMessages: true,
          forwardDeveloperMessages: true,
        },
        { messages },
      );

      expect(request.systemPrompts).toEqual([
        "You are a helpful assistant.",
        "System instruction",
        "Developer hint",
      ]);
    });
  });

  describe("Tool Configuration", () => {
    const inputTool = {
      name: "inputTool",
      description: "From input",
      parameters: { type: "object", properties: {} },
    };

    it("offers config tools as JSON Schema", async () => {
      const { tool } = recordingTool();
      const request = await firstRequest({ tools: [tool] });

      const lookup = request.tools?.find((t) => t.name === "lookup");
      expect(lookup?.inputSchema).toMatchObject({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
    });

    it("offers frontend tools, config tools, and the state tools together", async () => {
      const { tool } = recordingTool();
      const request = await firstRequest(
        { tools: [tool] },
        { tools: [inputTool] },
      );

      expect(requestToolNames(request)).toEqual([
        "inputTool",
        "lookup",
        "AGUISendStateSnapshot",
        "AGUISendStateDelta",
      ]);
    });

    it("lets a config tool replace a frontend tool with the same name", async () => {
      const { tool } = recordingTool();
      const request = await firstRequest(
        { tools: [tool] },
        { tools: [{ ...inputTool, name: "lookup" }] },
      );

      const lookups = request.tools?.filter((t) => t.name === "lookup");
      expect(lookups).toHaveLength(1);
      expect(lookups?.[0]?.execute).toBeTypeOf("function");
    });

    it("keeps frontend tool schemas as sent, so A2UI components stay open", async () => {
      const request = await firstRequest({}, { tools: [RENDER_A2UI_TOOL] });

      const a2ui = request.tools?.find((t) => t.name === RENDER_A2UI_TOOL.name);
      expect(a2ui?.inputSchema).toEqual(RENDER_A2UI_TOOL.parameters);
      expect(a2ui?.execute).toBeUndefined();
    });
  });

  describe("Model options and overrides", () => {
    it("passes modelOptions and toolChoice to the model unchanged", async () => {
      const request = await firstRequest({
        modelOptions: { temperature: 0.5, reasoning: { effort: "low" } },
        toolChoice: "required",
      });

      expect(request.modelOptions).toEqual({
        temperature: 0.5,
        reasoning: { effort: "low" },
      });
      expect(request.toolChoice).toBe("required");
    });

    it("replaces modelOptions from forwardedProps only when overridable", async () => {
      const forwardedProps = { modelOptions: { temperature: 0.9 } };
      const config = { modelOptions: { temperature: 0.5 } };

      const locked = await firstRequest(config, { forwardedProps });
      const open = await firstRequest(
        { ...config, overridableProperties: ["modelOptions"] },
        { forwardedProps },
      );

      expect(locked.modelOptions).toEqual({ temperature: 0.5 });
      expect(open.modelOptions).toEqual({ temperature: 0.9 });
    });

    it("takes a forwarded tool choice in TanStack or AI SDK shape when overridable", async () => {
      const config = { overridableProperties: ["toolChoice" as const] };

      const named = await firstRequest(config, {
        forwardedProps: { toolChoice: { type: "tool", name: "lookup" } },
      });
      const aiSdkShape = await firstRequest(config, {
        forwardedProps: { toolChoice: { type: "tool", toolName: "lookup" } },
      });
      const invalid = await firstRequest(config, {
        forwardedProps: { toolChoice: "sometimes" },
      });

      expect(named.toolChoice).toEqual({ type: "tool", name: "lookup" });
      expect(aiSdkShape.toolChoice).toEqual({ type: "tool", name: "lookup" });
      expect(invalid.toolChoice).toBeUndefined();
    });
  });

  describe("Model guard", () => {
    it("rejects a model string when the agent is constructed", () => {
      // A JavaScript caller can still pass a string; the types forbid it.
      // @ts-expect-error model must be a TanStack AI text adapter
      expect(() => new BuiltInAgent({ model: "openai/gpt-5" })).toThrow(
        'BuiltInAgent "model" got the string "openai/gpt-5". Pass a TanStack AI text adapter instead, such as openaiText("gpt-5") from "@tanstack/ai-openai".',
      );
    });

    it("rejects an AI SDK model object when the agent is constructed", () => {
      const aiSdkModel = {
        specificationVersion: "v3",
        provider: "openai.responses",
        modelId: "gpt-5",
        doStream: async () => ({}),
      };

      // An AI SDK model is not a TanStack adapter; this is the wrong value a
      // JavaScript caller can still pass.
      // @ts-expect-error model must be a TanStack AI text adapter
      expect(() => new BuiltInAgent({ model: aiSdkModel })).toThrow(
        'Run AI SDK models with a factory: new BuiltInAgent({ type: "aisdk", factory: ... })',
      );
    });
  });

  describe("Error Handling", () => {
    it("emits RUN_ERROR with the model's message and errors the observable", async () => {
      const { agent } = createClassicAgent({}, [{ error: "provider 500" }]);

      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(createDefaultInput()),
      );

      expect(errored).toBe(true);
      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "provider 500",
      });
      expect(eventsOfType(events, EventType.RUN_FINISHED)).toHaveLength(0);
    });
  });

  describe("Reasoning Event Emission", () => {
    it("emits the reasoning lifecycle before the answer text", async () => {
      const { events } = await runClassicAgent({}, [
        { thinking: "Let me think", text: "Answer" },
      ]);

      const reasoningTypes = [
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END,
        EventType.TEXT_MESSAGE_CHUNK,
      ];
      const types = events
        .map((e) => e.type)
        .filter((type) => reasoningTypes.includes(type));
      expect([...new Set(types)]).toEqual(reasoningTypes);
      expect(
        eventsOfType(events, EventType.REASONING_MESSAGE_CONTENT)
          .map((e) => e.delta)
          .join(""),
      ).toBe("Let me think");
    });
  });

  describe("Abort", () => {
    /** Aborts the run from inside the model call, then answers. */
    async function runAborted(protocolVersion?: string) {
      const harness = createClassicAgent({}, [
        () => {
          harness.agent.abortRun();
          return { text: "too late" };
        },
      ]);
      const result = await collectEventsIncludingErrors(
        harness.agent.run(
          createDefaultInput(protocolVersion ? { protocolVersion } : {}),
        ),
      );
      return result;
    }

    it("finishes an aborted run as cancelled for a 1.0 client", async () => {
      const { events, errored } = await runAborted("1.0");

      expect(errored).toBe(false);
      expect(streamedText(events)).toBe("");
      expect(eventsOfType(events, EventType.RUN_ERROR)).toHaveLength(0);
      expect(events.at(-1)).toMatchObject({
        type: EventType.RUN_FINISHED,
        outcome: { type: "cancelled" },
      });
    });

    it("finishes an aborted run without an outcome for a client that declares no version", async () => {
      const { events } = await runAborted();

      expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
      expect(events.at(-1)).not.toHaveProperty("outcome");
    });
  });

  describe("clone()", () => {
    it("runs the clone with the same configuration", async () => {
      const { agent } = createClassicAgent({ prompt: "Be brief." }, [
        { text: "from clone" },
      ]);
      const cloned = agent.clone();

      const { events } = await collectEventsIncludingErrors(
        cloned.run(createDefaultInput()),
      );

      expect(cloned).not.toBe(agent);
      expect(streamedText(events)).toBe("from clone");
    });
  });
});
