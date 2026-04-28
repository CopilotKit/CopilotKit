/**
 * LangGraph TypeScript agent backing the Open-Ended Generative UI (Advanced) demo.
 *
 * Port of `langgraph-python/src/agents/open_gen_ui_advanced_agent.py`.
 *
 * The "advanced" variant: the agent-authored, sandboxed UI can invoke
 * frontend-registered **sandbox functions** — functions the app defines on
 * the host page (see `src/app/demos/open-gen-ui-advanced/sandbox-functions.ts`)
 * and makes callable from inside the iframe via
 * `await Websandbox.connection.remote.<name>(args)`.
 *
 * The agent itself doesn't define tools. The frontend-registered
 * `generateSandboxedUi` tool arrives via `state.copilotkit.actions` and the
 * sandbox-function descriptors arrive via `state.copilotkit.context`. The
 * system prompt teaches the LLM the sandbox-function calling contract.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  END,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const SYSTEM_PROMPT = `You are a UI-generating assistant for the Open Generative UI (Advanced) demo.

On every user turn you MUST call the \`generateSandboxedUi\` frontend tool
exactly once. The generated UI must be INTERACTIVE and must invoke the
available host-side sandbox functions described in your agent context
(delivered via \`copilotkit.context\`) in response to user interactions.

Sandbox-function calling contract (inside the generated iframe):
- Call a host function with:
      await Websandbox.connection.remote.<functionName>(args)
  The call returns a Promise; await it.
- Each handler returns a plain object. Read the return shape from the
  function's description in your context and use the EXACT field names
  it returns (e.g. if the description says the handler returns
  \`{ ok, value }\`, read \`res.value\` — not \`res.result\`).
- Descriptions, names, and JSON-schema parameter shapes for every
  available sandbox function are listed in your context. Read them
  carefully and wire at least one interactive UI element to call one.

Sandbox iframe restrictions (CRITICAL):
- The iframe runs with \`sandbox="allow-scripts"\` ONLY. Forms are NOT
  allowed. You MUST NOT use \`<form>\` elements or \`<button type="submit">\`.
  Clicking a submit button inside a sandboxed form is blocked by the
  browser BEFORE any onsubmit handler runs, so the sandbox-function call
  never fires.
- Use plain \`<button type="button">\` elements and wire them with
  \`addEventListener('click', ...)\` or an inline click handler. Do the same
  for "Enter" keypresses on inputs: attach a \`keydown\` listener that
  checks \`e.key === 'Enter'\` and calls your handler directly — do NOT
  wrap inputs in a \`<form>\`.

Generation guidance:
- Emit \`initialHeight\` and \`placeholderMessages\` first, then CSS, then
  HTML, then \`jsFunctions\` / \`jsExpressions\` if helpful.
- Always include a visible result element (e.g. an output div) that you
  UPDATE after the sandbox function resolves, so the user can *see* the
  round-trip: "Button clicked -> remote call -> visible result".
- Use CDN scripts (Chart.js, D3, etc.) via <script> tags in the HTML head
  when you need libraries.
- Do NOT use fetch/XHR, localStorage, or document.cookie — the sandbox has
  no same-origin access. ONLY use \`Websandbox.connection.remote.*\` for
  host-page interactions.
- Keep your own chat message brief (1 sentence max); the rendered UI is
  the real output.
`;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({
    model: "gpt-4.1",
    modelKwargs: { parallel_tool_calls: false },
  });

  const frontendTools = convertActionsToDynamicStructuredTools(
    state.copilotkit?.actions ?? [],
  );
  const modelWithTools = model.bindTools!(frontendTools);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", END);

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
