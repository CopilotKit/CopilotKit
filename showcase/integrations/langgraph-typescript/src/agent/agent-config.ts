/**
 * LangGraph TypeScript agent backing the Agent Config Object demo.
 *
 * Reads three frontend-published context values — tone, expertise,
 * responseLength — from ``state.copilotkit.context`` and builds its system
 * prompt dynamically per turn.
 *
 * The frontend uses `useAgentContext` to publish the config object on each
 * render. This graph reads the latest matching context entry with defensive
 * defaults (unknown / missing values fall back to the defaults) and composes
 * the system prompt from three small rulebooks before invoking the model.
 */

import { makeChatOpenAI } from "./openai-headers";

// @region[agent-config-setup]
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AIMessage } from "@langchain/core/messages";
import { SystemMessage } from "@langchain/core/messages";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsConfigKeys(value: Record<string, unknown>): boolean {
  return "tone" in value || "expertise" in value || "responseLength" in value;
}

function extractConfigContext(context: unknown): Record<string, unknown> {
  if (typeof context === "string") {
    try {
      return extractConfigContext(JSON.parse(context));
    } catch {
      return {};
    }
  }

  if (Array.isArray(context)) {
    for (const entry of [...context].toReversed()) {
      const extracted = extractConfigContext(entry);
      if (containsConfigKeys(extracted)) return extracted;
    }
    return {};
  }

  if (!isRecord(context)) return {};
  const value = context.value;
  if (typeof value === "string") {
    const parsed = extractConfigContext(value);
    if (containsConfigKeys(parsed)) return parsed;
  }
  if (isRecord(value) && containsConfigKeys(value)) return value;
  return containsConfigKeys(context) ? context : {};
}

function readForwardedProperties(
  config: RunnableConfig | undefined,
): Record<string, unknown> {
  const configurable =
    (config?.configurable as Record<string, unknown> | undefined) ?? {};
  return (configurable.properties as Record<string, unknown> | undefined) ?? {};
}

function readConfig(state: AgentState, config: RunnableConfig): ResolvedProps {
  const contextConfig = extractConfigContext(state.copilotkit?.context);
  const properties = containsConfigKeys(contextConfig)
    ? contextConfig
    : readForwardedProperties(config);

  const toneRaw = properties.tone;
  const expertiseRaw = properties.expertise;
  const responseLengthRaw = properties.responseLength;

  const tone =
    typeof toneRaw === "string" && VALID_TONES.has(toneRaw)
      ? (toneRaw as Tone)
      : DEFAULT_TONE;
  const expertise =
    typeof expertiseRaw === "string" && VALID_EXPERTISE.has(expertiseRaw)
      ? (expertiseRaw as Expertise)
      : DEFAULT_EXPERTISE;
  const responseLength =
    typeof responseLengthRaw === "string" &&
    VALID_RESPONSE_LENGTHS.has(responseLengthRaw)
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
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.4,
  });
  const props = readConfig(state, config);
  const systemPrompt = buildSystemPrompt(props);

  const response = (await model.invoke(
    [new SystemMessage({ content: systemPrompt }), ...state.messages],
    config,
  )) as AIMessage;

  return { messages: response };
}
// @endregion[agent-config-setup]

// Showcase-specific wrapper: uses makeChatOpenAI for aimock header forwarding.
// The chatNode above (inside the region) uses the public ChatOpenAI API for docs.
async function chatNodeWithHeaders(state: AgentState, config: RunnableConfig) {
  const model = makeChatOpenAI(config, {
    model: "gpt-4o-mini",
    temperature: 0.4,
  });
  const props = readConfig(state, config);
  const systemPrompt = buildSystemPrompt(props);

  const response = (await model.invoke(
    [new SystemMessage({ content: systemPrompt }), ...state.messages],
    config,
  )) as AIMessage;

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNodeWithHeaders)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", "__end__");

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
