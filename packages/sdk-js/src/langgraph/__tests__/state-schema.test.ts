import { StateGraph, END, START, StateSchema } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import * as z from "zod";

import { CopilotKitStateSchema } from "../state-schema";
import { CopilotKitPropertiesSchema } from "../types";

describe("CopilotKitStateSchema", () => {
  it("exposes `copilotkit` and `messages` fields for composition", () => {
    expect(Object.keys(CopilotKitStateSchema.fields).sort()).toEqual([
      "copilotkit",
      "messages",
    ]);
  });

  it("can be used directly as a StateGraph schema", async () => {
    const graph = new StateGraph(CopilotKitStateSchema)
      .addNode("echo", (state) => ({ messages: state.messages }))
      .addEdge(START, "echo")
      .addEdge("echo", END)
      .compile();

    const result = await graph.invoke({
      messages: [new HumanMessage("hello")],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("hello");
  });

  it("can be extended with user fields via spread", async () => {
    const AgentStateSchema = new StateSchema({
      language: z.enum(["english", "spanish"]).default("english"),
      ...CopilotKitStateSchema.fields,
    });

    const graph = new StateGraph(AgentStateSchema)
      .addNode("chat", (state) => ({ language: state.language }))
      .addEdge(START, "chat")
      .addEdge("chat", END)
      .compile();

    const result = await graph.invoke({
      language: "spanish",
      messages: [new HumanMessage("hola")],
    });

    expect(result.language).toBe("spanish");
    expect(result.messages).toHaveLength(1);
  });

  it("preserves copilotkit runtime state across nodes", async () => {
    const graph = new StateGraph(CopilotKitStateSchema)
      .addNode("noop", (state) => ({ copilotkit: state.copilotkit }))
      .addEdge(START, "noop")
      .addEdge("noop", END)
      .compile();

    const result = await graph.invoke({
      copilotkit: {
        actions: [{ name: "doThing" }],
        context: [{ description: "user", value: "alice" }],
        interceptedToolCalls: [],
        originalAIMessageId: "msg-1",
      },
      messages: [],
    });

    expect(result.copilotkit.actions).toEqual([{ name: "doThing" }]);
    expect(result.copilotkit.context).toEqual([
      { description: "user", value: "alice" },
    ]);
    expect(result.copilotkit.originalAIMessageId).toBe("msg-1");
  });

  it("exposes a standard schema shape for copilotkit properties", () => {
    expect(CopilotKitPropertiesSchema["~standard"].version).toBe(1);
    expect(CopilotKitPropertiesSchema["~standard"].vendor).toBe(
      "@copilotkit/sdk-js",
    );
    expect(
      typeof CopilotKitPropertiesSchema["~standard"].jsonSchema.input,
    ).toBe("function");
  });
});
