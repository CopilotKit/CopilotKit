/**
 * LangGraph TypeScript agent backing the In-App HITL (frontend-tool + popup) demo.
 *
 * The agent is a support assistant that processes customer-care requests
 * (refunds, account changes, escalations). Any action that materially
 * affects a customer MUST be confirmed by the human operator via the
 * frontend-provided `request_user_approval` tool.
 *
 * The tool is defined on the frontend via `useFrontendTool` with an async
 * handler that opens a modal dialog OUTSIDE the chat surface. The handler
 * awaits the user's decision and resolves with
 * `{"approved": bool, "reason": str}`. This agent treats that result as
 * authoritative: if `approved` is `true`, continue; otherwise, stop and
 * explain the decision back to the user.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const AgentStateAnnotation = CopilotKitStateAnnotation;
export type AgentState = typeof AgentStateAnnotation.State;

const SYSTEM_PROMPT =
  "You are a support operations copilot working alongside a human operator " +
  "inside an internal support console. The operator can see a list of open " +
  "support tickets on the left side of their screen and is chatting with " +
  "you on the right.\n" +
  "\n" +
  "Whenever the operator asks you to take an action that affects a " +
  "customer — for example: issuing a refund, updating a customer's plan, " +
  "cancelling a subscription, escalating a ticket, or sending an apology " +
  "credit — you MUST first call the frontend-provided " +
  "`request_user_approval` tool to obtain the operator's explicit consent.\n" +
  "\n" +
  "How to use `request_user_approval`:\n" +
  "- `message`: a short, plain-English summary of the exact action you " +
  "  are about to take, including concrete numbers (e.g. '$50 refund to " +
  "  customer #12345').\n" +
  "- `context`: optional extra context the operator might want to review " +
  "  (the ticket ID, the policy rule you're applying, etc.). Keep it to " +
  "  one or two short sentences.\n" +
  "\n" +
  "The tool returns an object of the shape " +
  '`{"approved": boolean, "reason": string | null}`.\n' +
  "- If `approved` is `true`: confirm in one short sentence that you are " +
  "  processing the action. You do not actually need to call any other " +
  "  tool — this is a demo. Just acknowledge.\n" +
  "- If `approved` is `false`: acknowledge the rejection in one short " +
  "  sentence and, if `reason` is non-empty, reflect the operator's " +
  "  reason back to them. Do NOT retry the action.\n" +
  "\n" +
  "Keep all chat replies to one or two short sentences. Never make up " +
  "customer data — always use whatever the operator told you in the " +
  "prompt.";

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
  ]);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", "__end__");

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
