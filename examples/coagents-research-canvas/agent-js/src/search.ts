/**
 * Search Node
 */

/**
 * The search node is responsible for searching the internet for information.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { tavily } from "@tavily/core";
import { AgentState } from "./state";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { getModel } from "./model";

const ResourceInput = z.object({
  url: z.string().describe("The URL of the resource"),
  title: z.string().describe("The title of the resource"),
  description: z.string().describe("A short description of the resource"),
});

const ExtractResources = tool(() => {}, {
  name: "ExtractResources",
  description: "Extract the 3-5 most relevant resources from a search result.",
  schema: z.object({ resources: z.array(ResourceInput) }),
});

const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

export async function search_node(state: AgentState, config: RunnableConfig) {
  const aiMessage = state["messages"][
    state["messages"].length - 1
  ] as AIMessage;

  state["resources"] = state.resources || [];
  state["logs"] = state.logs || [];
  const queries = aiMessage.tool_calls![0]["args"]["queries"];

  for (const query of queries) {
    state["logs"].push({
      message: `Search for ${query}`,
      done: false,
    });
  }

  // TODO
  //     await copilotkit_emit_state(config, state)

  const search_results = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const response = await tavilyClient.search(query, {});
    search_results.push(response);
    state["logs"][i]["done"] = true;

    // TODO
    // await copilotkit_emit_state(config, state);
  }

  // TODO
  // config = copilotkit_customize_config(
  //   config,
  //   emit_intermediate_state=[{
  //       "state_key": "resources",
  //       "tool": "ExtractResources",
  //       "tool_argument": "resources",
  //   }],
  // )

  const model = getModel(state);
  const invokeArgs: Record<string, any> = {};
  if (model.constructor.name === "ChatOpenAI") {
    invokeArgs["parallel_tool_calls"] = false;
  }

  const response = await model.bindTools!([ExtractResources], {
    ...invokeArgs,
    tool_choice: "ExtractResources",
  }).invoke(
    [
      new SystemMessage({
        content: `You need to extract the 3-5 most relevant resources from the following search results.`,
      }),
      ...state["messages"],
      new ToolMessage({
        tool_call_id: aiMessage.tool_calls![0]["id"]!,
        content: `Performed search: ${search_results}`,
      }),
    ],
    config
  );

  state["logs"] = [];

  // TODO
  // await copilotkit_emit_state(config, state);

  const aiMessageResponse = response as AIMessage;
  const resources = aiMessageResponse.tool_calls![0]["args"]["resources"];

  state["resources"].push(...resources);

  state["messages"].push(
    new ToolMessage({
      tool_call_id: aiMessage.tool_calls![0]["id"]!,
      content: `Added the following resources: ${resources}`,
    })
  );

  return state;
}
