/**
 * Delete Resources
 */

import type { AgentState } from "./state";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ToolMessage, AIMessage } from "@langchain/core/messages";

export async function delete_node(
  state: AgentState,
  config: RunnableConfig,
): Promise<AgentState> {
  /**
   * Delete Node
   */
  return state;
}

export async function perform_delete_node(
  state: AgentState,
  config: RunnableConfig,
) {
  /**
   * Perform Delete Node
   */
  const aiMessage = state["messages"][
    state["messages"].length - 2
  ] as AIMessage;
  const toolMessage = state["messages"][
    state["messages"].length - 1
  ] as ToolMessage;

  let resources = state["resources"];

  if (toolMessage.content === "YES") {
    let urls: string[];

    if (aiMessage.tool_calls) {
      urls = aiMessage.tool_calls[0].args.urls;
    } else {
      const parsedToolCall = JSON.parse(
        aiMessage.additional_kwargs!.function_call!.arguments,
      );
      urls = parsedToolCall.urls;
    }

    resources = resources.filter((resource) => !urls.includes(resource.url));
  }

  return {
    resources,
  };
}
