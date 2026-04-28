/**
 * LangGraph TypeScript agent backing the Agent Config Object demo.
 *
 * Reads three forwarded properties — tone, expertise, responseLength — from
 * the LangGraph run's ``RunnableConfig.configurable.properties`` and builds
 * its system prompt dynamically per turn.
 *
 * The CopilotKit provider's `properties` prop is wired through the runtime
 * as `forwardedProps` on each AG-UI run. This graph reads those with
 * defensive defaults (unknown / missing values fall back to the defaults)
 * and composes the system prompt from three small rulebooks before invoking
 * the model.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

type Tone = "professional" | "casual" | "enthusiastic";
type Expertise = "beginner" | "intermediate" | "expert";
type ResponseLength = "concise" | "detailed";

const DEFAULT_TONE: Tone = "professional";
const DEFAULT_EXPERTISE: Expertise = "intermediate";
const DEFAULT_RESPONSE_LENGTH: ResponseLength = "concise";

const VALID_TONES = new Set<string>(["professional", "casual", "enthusiastic"]);
const VALID_EXPERTISE = new Set<string>(["beginner", "intermediate", "expert"]);
const VALID_RESPONSE_LENGTHS = new Set<string>(["concise", "detailed"]);

interface ResolvedProps {
  tone: Tone;
  expertise: Expertise;
  responseLength: ResponseLength;
}

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

type AgentState = typeof AgentStateAnnotation.State;

/**
 * Read the forwarded `properties` object with defensive defaults. Any
 * missing or unrecognized value falls back to the corresponding default
 * constant. The function never throws.
 */
function readProperties(config: RunnableConfig | undefined): ResolvedProps {
  const configurable =
    (config?.configurable as Record<string, unknown> | undefined) ?? {};
  const properties =
    (configurable.properties as Record<string, unknown> | undefined) ?? {};

  const toneRaw = properties.tone as string | undefined;
  const expertiseRaw = properties.expertise as string | undefined;
  const responseLengthRaw = properties.responseLength as string | undefined;

  const tone =
    toneRaw && VALID_TONES.has(toneRaw) ? (toneRaw as Tone) : DEFAULT_TONE;
  const expertise =
    expertiseRaw && VALID_EXPERTISE.has(expertiseRaw)
      ? (expertiseRaw as Expertise)
      : DEFAULT_EXPERTISE;
  const responseLength =
    responseLengthRaw && VALID_RESPONSE_LENGTHS.has(responseLengthRaw)
      ? (responseLengthRaw as ResponseLength)
      : DEFAULT_RESPONSE_LENGTH;

  return { tone, expertise, responseLength };
}

const TONE_RULES: Record<Tone, string> = {
  professional: "Use neutral, precise language. No emoji. Short sentences.",
  casual:
    "Use friendly, conversational language. Contractions OK. Light humor welcome.",
  enthusiastic:
    "Use upbeat, energetic language. Exclamation points OK. Emoji OK.",
};

const EXPERTISE_RULES: Record<Expertise, string> = {
  beginner: "Assume no prior knowledge. Define jargon. Use analogies.",
  intermediate:
    "Assume common terms are understood; explain specialized terms.",
  expert: "Assume technical fluency. Use precise terminology. Skip basics.",
};

const LENGTH_RULES: Record<ResponseLength, string> = {
  concise: "Respond in 1-3 sentences.",
  detailed: "Respond in multiple paragraphs with examples where relevant.",
};

function buildSystemPrompt(props: ResolvedProps): string {
  return [
    "You are a helpful assistant.",
    "",
    `Tone: ${TONE_RULES[props.tone]}`,
    `Expertise level: ${EXPERTISE_RULES[props.expertise]}`,
    `Response length: ${LENGTH_RULES[props.responseLength]}`,
  ].join("\n");
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.4 });
  const props = readProperties(config);
  const systemPrompt = buildSystemPrompt(props);

  const response = (await model.invoke(
    [new SystemMessage({ content: systemPrompt }), ...state.messages],
    config,
  )) as AIMessage;

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", "__end__");

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
