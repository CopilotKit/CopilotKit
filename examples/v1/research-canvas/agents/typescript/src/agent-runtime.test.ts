import { HumanMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { getModel } from "./model";
import { AgentStateAnnotation } from "./state";
import type { AgentState } from "./state";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Creates a complete agent state without calling an external service. */
function createState(model: string): AgentState {
  return {
    copilotkit: {
      actions: [],
      context: [],
      interceptedToolCalls: [],
      originalAIMessageId: "",
    },
    logs: [],
    messages: [],
    model,
    report: "",
    research_question: "",
    resources: [],
  };
}

test.each(["openai", "anthropic", "google_genai"])(
  "%s can bind a research tool with the installed LangChain core",
  (provider) => {
    vi.stubEnv("MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("GOOGLE_API_KEY", "test-google-key");

    const model = getModel(createState(provider));
    const boundModel = model.bindTools?.([
      {
        name: "Search",
        description: "Find research resources.",
        schema: z.object({ queries: z.array(z.string()) }),
      },
    ]);

    expect(boundModel).toBeDefined();
  },
);

test("the GPT-5 mini request omits unsupported sampling parameters", () => {
  vi.stubEnv("MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

  const model = getModel(createState("openai"));
  if (!(model instanceof ChatOpenAI)) {
    throw new Error("The OpenAI provider must return ChatOpenAI");
  }

  const request = model.invocationParams();
  expect(request.model).toBe("gpt-5-mini");
  expect(request.temperature).toBeUndefined();
  expect(request.top_p).toBeUndefined();
});

test("the SDK message reducer works with the agent's LangGraph state", async () => {
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("reply", () => ({
      messages: [new HumanMessage("Second message")],
    }))
    .addEdge(START, "reply")
    .addEdge("reply", END)
    .compile();

  const result = await graph.invoke({
    ...createState("openai"),
    messages: [new HumanMessage("First message")],
  });

  expect(result.messages.map((message) => message.content)).toEqual([
    "First message",
    "Second message",
  ]);
});

test("the research graph compiles with its tools and deletion interrupt", async () => {
  vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
  const { graph } = await import("./agent.js");
  const drawableGraph = await graph.getGraphAsync();

  expect(Object.keys(drawableGraph.nodes)).toEqual(
    expect.arrayContaining([
      "download",
      "chat_node",
      "search_node",
      "delete_node",
      "perform_delete_node",
    ]),
  );
  expect(graph.interruptAfter).toEqual(["delete_node"]);
});
