// The agent of the Agent Config Object demo.
//
// The factory reads `input.forwardedProps` (which the CopilotKit provider
// populates from its `properties` prop) and prepends a tone/expertise/
// length-tuned system prompt per turn.

import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "../openai-text";
// Custom fetch that adds the inbound x-* headers (e.g. x-aimock-context) to
// every outbound OpenAI call. See ../header-forwarding.ts.
import { forwardingFetch } from "../header-forwarding";

const TONE_GUIDANCE: Record<string, string> = {
  professional:
    "Use a measured, professional tone. Avoid slang and exclamation marks.",
  casual:
    "Use a friendly, conversational tone — like talking to a coworker over coffee.",
  enthusiastic:
    "Use an upbeat, energetic tone. Show genuine excitement about the topic.",
};

const EXPERTISE_GUIDANCE: Record<string, string> = {
  beginner:
    "Assume the user is new to this topic. Avoid jargon; define terms inline.",
  intermediate:
    "Assume the user has working familiarity. You can use common technical terms without defining each one.",
  expert:
    "Assume the user is an expert. You can use precise jargon and skip introductory framing.",
};

const RESPONSE_LENGTH_GUIDANCE: Record<string, string> = {
  concise:
    "Keep responses tight — 1-3 short sentences, or a 3-bullet list at most.",
  detailed:
    "Provide a thorough answer. Use headings, paragraphs, or longer lists when warranted.",
};

function buildConfigSystemPrompt(props: Record<string, unknown>): string {
  const tone = typeof props.tone === "string" ? props.tone : "professional";
  const expertise =
    typeof props.expertise === "string" ? props.expertise : "intermediate";
  const responseLength =
    typeof props.responseLength === "string" ? props.responseLength : "concise";

  const toneLine = TONE_GUIDANCE[tone] ?? TONE_GUIDANCE.professional;
  const expertiseLine =
    EXPERTISE_GUIDANCE[expertise] ?? EXPERTISE_GUIDANCE.intermediate;
  const lengthLine =
    RESPONSE_LENGTH_GUIDANCE[responseLength] ??
    RESPONSE_LENGTH_GUIDANCE.concise;

  return [
    "You adapt your responses based on the active agent config:",
    `- tone=${tone}: ${toneLine}`,
    `- expertise=${expertise}: ${expertiseLine}`,
    `- responseLength=${responseLength}: ${lengthLine}`,
    "Mention the active config (tone / expertise / responseLength) at the start of each reply so the user can see it took effect.",
  ].join("\n");
}

export function createAgentConfigAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const props = (input.forwardedProps ?? {}) as Record<string, unknown>;
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText("gpt-6-luna", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [buildConfigSystemPrompt(props), ...systemPrompts],
        tools: [],
        abortController,
      });
    },
  });
}
