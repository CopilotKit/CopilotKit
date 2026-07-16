/**
 * This is the main entry point for the AI.
 * It defines the workflow graph and the entry point for the agent.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation } from "./state";
import { download_node } from "./download";
import { chat_node } from "./chat";
import { search_node } from "./search";
import { delete_node, perform_delete_node } from "./delete";

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("download", download_node)
  .addNode("chat_node", chat_node)
  .addNode("search_node", search_node)
  .addNode("delete_node", delete_node)
  .addNode("perform_delete_node", perform_delete_node)
  .setEntryPoint("download")
  .addEdge("download", "chat_node")
  .addConditionalEdges("chat_node", route, [
    "search_node",
    "chat_node",
    "delete_node",
    END,
  ])
  .addEdge("delete_node", "perform_delete_node")
  .addEdge("perform_delete_node", "chat_node")
  .addEdge("search_node", "download");

export const graph = workflow.compile({
  interruptAfter: ["delete_node"],
});

function route(state: AgentState) {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage) {
    const aiMessage = lastMessage as AIMessage;
    const toolName = aiMessage.tool_calls?.[0]?.name;

    if (toolName === "Search") {
      return "search_node";
    } else if (toolName === "DeleteResources") {
      return "delete_node";
    } else if (toolName) {
      return "chat_node";
    }
  }
  if (lastMessage?.constructor.name === "ToolMessage") {
    return "chat_node";
  }
  return END;
}
