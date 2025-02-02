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

const memory = new MemorySaver();
export const graph = workflow.compile({
  checkpointer: memory,
  interruptAfter: ["delete_node"],
});

function route(state: AgentState) {
  const messages = state.messages || [];

  if (
    messages.length > 0 &&
    messages[messages.length - 1].constructor.name === "AIMessageChunk"
  ) {
    const aiMessage = messages[messages.length - 1] as AIMessage;

    if (
      aiMessage.tool_calls &&
      aiMessage.tool_calls.length > 0 &&
      aiMessage.tool_calls[0].name === "Search"
    ) {
      return "search_node";
    } else if (
      aiMessage.tool_calls &&
      aiMessage.tool_calls.length > 0 &&
      aiMessage.tool_calls[0].name === "DeleteResources"
    ) {
      return "delete_node";
    }
  }
  if (
    messages.length > 0 &&
    messages[messages.length - 1].constructor.name === "ToolMessage"
  ) {
    return "chat_node";
  }
  return END;
}
