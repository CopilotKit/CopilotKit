import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import type * as AISDK from "ai";
import { BasicAgent } from "../index";
import { convertInputToTanStackAI } from "../converters/tanstack";
import {
  prependToNewestUserMessage,
  sortToolsByName,
} from "../context-placement";
import { mockStreamTextResponse, finish, collectEvents } from "./test-helpers";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof AISDK>()),
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

const tool = (name: string) => ({
  name,
  description: `${name} tool`,
  parameters: { type: "object", properties: {} },
});

// Two turns of one thread. The page, the state and the order of the frontend
// tools change between them, as they do in a real app.
const turn = (n: 1 | 2): RunAgentInput => ({
  threadId: "thread-1",
  runId: `run-${n}`,
  messages: [
    { id: "u1", role: "user", content: "First question" },
    { id: "a1", role: "assistant", content: "First answer" },
    ...(n === 2
      ? [
          { id: "u2", role: "user" as const, content: "Second question" },
          { id: "a2", role: "assistant" as const, content: "Second answer" },
          { id: "u3", role: "user" as const, content: "Third question" },
        ]
      : []),
  ],
  tools:
    n === 1
      ? [tool("b_tool"), tool("a_tool")]
      : [tool("a_tool"), tool("b_tool")],
  context: [
    { description: "Current page", value: n === 1 ? "/contacts" : "/pipeline" },
  ],
  state: { selected: n === 1 ? "c-101" : "c-204" },
  forwardedProps: {},
});

async function request(
  input: RunAgentInput,
  contextPlacement?: "system" | "message",
) {
  const agent = new BasicAgent({
    model: "openai/gpt-4o",
    prompt: "You are a CRM assistant.",
    contextPlacement,
  });
  vi.mocked(streamText).mockReturnValue(
    mockStreamTextResponse([finish()]) as any,
  );
  await collectEvents(agent["run"](input));
  return vi.mocked(streamText).mock.calls.at(-1)![0];
}

describe("contextPlacement on BuiltInAgent", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, OPENAI_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('keeps the system prompt and tools the same across turns with "message"', async () => {
    const first = await request(turn(1), "message");
    const second = await request(turn(2), "message");

    expect(second.system).toEqual(first.system);
    expect(JSON.stringify(second.system)).not.toContain("/pipeline");
    expect(Object.keys(second.tools!)).toEqual(Object.keys(first.tools!));
    // The earlier turns go to the model without the context.
    const messages = second.messages as { content: unknown }[];
    expect(JSON.stringify(messages.slice(0, 4))).not.toContain("/pipeline");
  });

  it('puts the context and the state at the start of the newest user message with "message"', async () => {
    const call = await request(turn(2), "message");
    const messages = call.messages as { role: string; content: unknown }[];
    const newest = JSON.stringify(messages.at(-1));

    expect(messages.at(-1)!.role).toBe("user");
    expect(newest).toContain("Context from the application");
    expect(newest).toContain("/pipeline");
    expect(newest).toContain("Application State");
    expect(newest).toContain("c-204");
    expect(newest.indexOf("/pipeline")).toBeLessThan(
      newest.indexOf("Third question"),
    );
  });

  it("keeps the context in the system prompt by default", async () => {
    const call = await request(turn(2));
    const system = JSON.stringify(call.system);

    expect(system).toContain("You are a CRM assistant.");
    expect(system).toContain("/pipeline");
    expect(system).toContain("c-204");
    expect(JSON.stringify(call.messages)).not.toContain("/pipeline");
  });

  it("keeps the context in the system prompt when no user message can carry it", async () => {
    const input: RunAgentInput = {
      ...turn(1),
      messages: [{ id: "a0", role: "assistant", content: "Welcome" }],
    };
    const call = await request(input, "message");

    expect(JSON.stringify(call.system)).toContain("/contacts");
  });

  it("sorts the frontend tools by name", async () => {
    const call = await request(turn(1));

    expect(Object.keys(call.tools!).slice(0, 2)).toEqual(["a_tool", "b_tool"]);
  });
});

describe("convertInputToTanStackAI contextPlacement", () => {
  it('keeps the system prompts the same across turns with "message"', () => {
    const first = convertInputToTanStackAI(turn(1), {
      contextPlacement: "message",
    });
    const second = convertInputToTanStackAI(turn(2), {
      contextPlacement: "message",
    });

    expect(second.systemPrompts).toEqual(first.systemPrompts);
    expect(second.tools.map((t) => t.name)).toEqual(["a_tool", "b_tool"]);
    expect(first.tools.map((t) => t.name)).toEqual(["a_tool", "b_tool"]);
    const newest = JSON.stringify(second.messages.at(-1));
    expect(newest).toContain("/pipeline");
    expect(newest).toContain("c-204");
  });

  it("keeps the context in the system prompts by default", () => {
    const { systemPrompts, messages } = convertInputToTanStackAI(turn(2));

    expect(systemPrompts.join("\n")).toContain("/pipeline");
    expect(JSON.stringify(messages)).not.toContain("/pipeline");
  });
});

describe("prependToNewestUserMessage", () => {
  it("adds a text part before the parts of a multipart message", () => {
    const placed = prependToNewestUserMessage(
      [
        {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "Look at this" }],
        },
      ],
      "Note",
    );

    expect(placed![0]!.content).toEqual([
      { type: "text", text: "Note\n\n" },
      { type: "text", text: "Look at this" },
    ]);
  });

  it("does not change the messages it gets", () => {
    const messages: RunAgentInput["messages"] = [
      { id: "u1", role: "user", content: "Hello" },
    ];
    prependToNewestUserMessage(messages, "Note");

    expect(messages[0]!.content).toBe("Hello");
  });
});

describe("sortToolsByName", () => {
  it("does not change the list it gets", () => {
    const tools = [tool("b"), tool("a")];

    expect(sortToolsByName(tools).map((t) => t.name)).toEqual(["a", "b"]);
    expect(tools.map((t) => t.name)).toEqual(["b", "a"]);
  });
});

describe("contextPlacement with an empty array state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...process.env, OPENAI_API_KEY: "test-key" };
  });

  it("leaves out the state section, as the system prompt does", async () => {
    const call = await request({ ...turn(2), state: [] }, "message");
    const newest = JSON.stringify(
      (call.messages as { content: unknown }[]).at(-1),
    );

    expect(newest).toContain("/pipeline");
    expect(newest).not.toContain("Application State");
  });
});
