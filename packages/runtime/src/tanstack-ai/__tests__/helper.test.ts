import { describe, expect, it } from "vitest";
import type { AnyTool } from "@tanstack/ai";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { defineTool } from "../../agent/index";
import type { AgentFactoryContext } from "../../agent/index";
import type { BuiltInAgentLearnedSkills } from "../../agent/learned-skills";
import { createDefaultInput } from "../../agent/__tests__/agent-test-helpers";
import { tanstackAI } from "../helper";
import type { TanStackAIOptions } from "../helper";

const noLearnedSkills: BuiltInAgentLearnedSkills = {
  catalog: "",
  definitions: [],
};

const skillsCatalog = "## Learned skills\n- refund-policy";

const learnedSkills: BuiltInAgentLearnedSkills = {
  catalog: skillsCatalog,
  definitions: [
    {
      name: "copilotkit_load_skill",
      description: "Load a skill",
      parameters: { type: "object", properties: {} },
      execute: async () => "skill",
    },
  ],
};

function createContext(
  overrides: Partial<Pick<AgentFactoryContext, "input" | "learnedSkills">>,
) {
  const abortController = new AbortController();
  const ctx: AgentFactoryContext = {
    input: createDefaultInput(),
    learnedSkills: noLearnedSkills,
    abortController,
    abortSignal: abortController.signal,
    interrupt: async () => [],
    onRunEnd: () => {},
    describeInterruptTool: () => {},
    ...overrides,
  };
  return ctx;
}

const showCardTool = {
  name: "showCard",
  description: "Show a card in the chat",
  parameters: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
};

const serverShowCard: AnyTool = {
  name: "showCard",
  description: "Show a card from the server",
  inputSchema: { type: "object", properties: {} },
  execute: async () => "shown",
};

function toolNamed(tools: AnyTool[], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

async function buildWith(
  options: TanStackAIOptions,
  overrides: Partial<Pick<AgentFactoryContext, "input" | "learnedSkills">> = {},
) {
  return tanstackAI(createContext(overrides), options);
}

describe("tanstackAI", () => {
  it("orders the system prompts: skills catalog, prompt, system message, context, state", async () => {
    const base = await buildWith(
      { prompt: "You are helpful." },
      {
        learnedSkills,
        input: createDefaultInput({
          messages: [
            { id: "s1", role: "system", content: "Be brief" },
            { id: "u1", role: "user", content: "Hi" },
          ],
          context: [{ description: "User", value: "Ada" }],
          state: { count: 1 },
        }),
      },
    );

    expect(base.systemPrompts).toEqual([
      skillsCatalog,
      "You are helpful.",
      "Be brief",
      "\n## Context from the application\nUser:\nAda\n",
      "\n## Application State\n" +
        "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
        '```json\n{\n  "count": 1\n}\n```\n',
    ]);
    expect(base.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("leaves out an empty prompt and an empty catalog", async () => {
    const base = await buildWith({ prompt: "" });

    expect(base.systemPrompts).toEqual([]);
  });

  it("returns the run's ids and abort controller", async () => {
    const ctx = createContext({
      input: createDefaultInput({ threadId: "thread-1", runId: "run-1" }),
    });

    const base = await tanstackAI(ctx);

    expect(base.threadId).toBe("thread-1");
    expect(base.runId).toBe("run-1");
    expect(base.abortController).toBe(ctx.abortController);
  });

  it("gives the model the frontend tools, the state tools, and the server tools", async () => {
    const lookup: AnyTool = {
      name: "lookup",
      description: "Look something up",
      inputSchema: { type: "object", properties: {} },
      execute: async () => "found",
    };

    const base = await buildWith(
      { tools: [lookup] },
      { input: createDefaultInput({ tools: [showCardTool] }) },
    );

    expect(base.tools.map((tool) => tool.name)).toEqual([
      "showCard",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "lookup",
    ]);
    const showCard = toolNamed(base.tools, "showCard");
    expect(showCard.inputSchema).toEqual(showCardTool.parameters);
    expect(showCard.execute).toBeUndefined();
  });

  it("lets a server tool replace a frontend tool with the same name", async () => {
    const base = await buildWith(
      { tools: [serverShowCard] },
      { input: createDefaultInput({ tools: [showCardTool] }) },
    );

    const showCards = base.tools.filter((tool) => tool.name === "showCard");
    expect(showCards).toEqual([serverShowCard]);
  });

  it("adds the learned-skills tools after the other tools", async () => {
    const base = await buildWith({}, { learnedSkills });

    expect(base.tools.map((tool) => tool.name)).toEqual([
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "copilotkit_load_skill",
    ]);
  });

  it("rejects a tool that uses a learned-skills tool name", async () => {
    const impostor: AnyTool = {
      name: "copilotkit_load_skill",
      description: "Not the real one",
      inputSchema: { type: "object", properties: {} },
    };

    await expect(
      buildWith({ tools: [impostor] }, { learnedSkills }),
    ).rejects.toThrow(
      "Tool name is reserved for learned skills: copilotkit_load_skill",
    );
  });

  it("maps a defineTool tool to a TanStack tool with a JSON Schema input", async () => {
    const getWeather = defineTool({
      name: "getWeather",
      description: "Get the weather",
      parameters: toStandardJsonSchema(v.object({ city: v.string() })),
      execute: async ({ city }) => `Sunny in ${city}`,
    });

    const base = await buildWith({ tools: [getWeather] });

    const tool = toolNamed(base.tools, "getWeather");
    expect(tool.description).toBe("Get the weather");
    expect(tool.inputSchema).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
    expect(tool.needsApproval).toBeUndefined();
    expect(await tool.execute?.({ city: "Paris" })).toBe("Sunny in Paris");
  });

  it("rejects defineTool input that fails the tool's schema", async () => {
    const getWeather = defineTool({
      name: "getWeather",
      description: "Get the weather",
      parameters: toStandardJsonSchema(v.object({ city: v.string() })),
      execute: async ({ city }) => `Sunny in ${city}`,
    });

    const base = await buildWith({ tools: [getWeather] });

    await expect(
      toolNamed(base.tools, "getWeather").execute?.({ city: 42 }),
    ).rejects.toThrow("Invalid input for tool getWeather:");
  });

  it("maps a defineTool interrupt tool to a tool that needs approval", async () => {
    const confirmPurchase = defineTool({
      name: "confirmPurchase",
      description: "Ask the user to confirm a purchase",
      parameters: toStandardJsonSchema(v.object({ item: v.string() })),
      interrupt: true,
    });

    const base = await buildWith({ tools: [confirmPurchase] });

    const tool = toolNamed(base.tools, "confirmPurchase");
    expect(tool.needsApproval).toBe(true);
    expect(tool.execute).toBeUndefined();
  });
});
