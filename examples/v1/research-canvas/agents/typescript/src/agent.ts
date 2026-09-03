/**
 * This is the main entry point for the AI.
 * It defines the workflow graph and the entry point for the agent.
 */

import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import type { AgentState } from "./state";
import { AgentStateAnnotation } from "./state";
import { download_node } from "./download";
import { chat_node } from "./chat";
import { search_node } from "./search";
import { delete_node, perform_delete_node } from "./delete";
import { getNextNode } from "./route";

function route(state: AgentState) {
  return getNextNode(state) ?? END;
}

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
