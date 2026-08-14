// Agent for the Agent Config Object demo (`agent-config-demo`).
//
// NOT A VERBATIM PORT — and it is the only file in this tree that is not.
// Upstream this agent has no factory module: the whole thing lives INLINE in
// `showcase/integrations/built-in-agent/src/app/api/copilotkit-agent-config/route.ts`.
// This app resolves agents through `src/lib/in-process-agents.ts`, which hands
// out an AGENT, not a route handler, so the agent half had to be lifted out.
//
// What was lifted, unchanged: the three guidance tables, `buildConfigSystemPrompt`,
// and `createAgentConfigAgent`. What was left behind: the `CopilotRuntime`, the
// `createCopilotRuntimeHandler`, `withProbeCompat`, and the `withForwardedHeaders`
// wrappers — all route-shaped, all already provided by this app's own route.
//
// One deliberate difference: the upstream inline agent says `gpt-5.5`, while
// every other factory in built-in-agent (and therefore every other file in this
// ported tree) is on `gpt-5.4`. This copy uses `gpt-5.4` for consistency with
// its thirteen siblings rather than tracking the one outlier. aimock fixtures
// key on `userMessage` + `context`, never on the model id, so replay is
// unaffected either way.
//
// Upstream was `gpt-4o` until it was changed to `gpt-5.5`; if the tree is ever
// aligned on a single model, this is one of the two places to change.
//
// The factory reads `input.forwardedProps` (which the CopilotKit provider
// populates from its `properties` prop) and prepends a tone/expertise/
// length-tuned system prompt per turn.

import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
// `withForwardedHeaders` snapshots inbound x-* headers (e.g.
// x-aimock-context) into an AsyncLocalStorage scope; `forwardingFetch`
// re-attaches them on every outbound LLM call. Required because
// `@tanstack/ai-openai`'s `openaiText()` adapter has no per-request
// header hook. See ../header-forwarding for the full rationale.
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

export function buildConfigSystemPrompt(
  props: Record<string, unknown>,
): string {
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
        adapter: openaiText("gpt-5.4", { fetch: forwardingFetch }),
        messages,
        systemPrompts: [buildConfigSystemPrompt(props), ...systemPrompts],
        tools: [],
        abortController,
      });
    },
  });
}
