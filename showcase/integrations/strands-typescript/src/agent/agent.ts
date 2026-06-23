/**
 * Agent factories for the Strands TypeScript showcase backend.
 *
 * `buildShowcaseAgent` is the single shared agent that serves the vast
 * majority of demos (the frontend differentiates each demo via
 * useFrontendTool / useRenderTool / useHumanInTheLoop / useAgentContext).
 * It mirrors the Python sibling's `build_showcase_agent` minus A2UI.
 *
 * The tool-free specialized agents (voice, byoc-hashbrown, byoc-json-render)
 * are mounted on dedicated sub-paths by `server.ts`.
 */

import { Agent } from "@strands-agents/sdk";
import { StrandsAgent } from "@ag-ui/aws-strands";
import type { StrandsAgentConfig } from "@ag-ui/aws-strands";
import { createModel } from "./model-factory";
import { SHOWCASE_TOOLS } from "./tools";
import {
  buildStatePrompt,
  salesStateFromArgs,
  notesStateFromArgs,
  stepsStateFromArgs,
  makeSubagentStateFromResult,
} from "./state";
import {
  SYSTEM_PROMPT,
  VOICE_SYSTEM_PROMPT,
  BYOC_HASHBROWN_SYSTEM_PROMPT,
  BYOC_JSON_RENDER_SYSTEM_PROMPT,
} from "./prompts";

export async function buildShowcaseAgent(): Promise<StrandsAgent> {
  const config: StrandsAgentConfig = {
    stateContextBuilder: buildStatePrompt,
    toolBehaviors: {
      // The weather card IS the response — halt after the first result so
      // the model doesn't loop or stream a redundant text summary.
      get_weather: { stopStreamingAfterResult: true },
      // Sales pipeline lives in shared state; emit the snapshot from args.
      manage_sales_todos: {
        skipMessagesSnapshot: true,
        stateFromArgs: salesStateFromArgs,
      },
      // Shared State (Read + Write) — notes panel.
      set_notes: { stateFromArgs: notesStateFromArgs },
      // gen-ui-agent — live progress card driven by set_steps transitions.
      set_steps: { stateFromArgs: stepsStateFromArgs },
      // Sub-agents — append a delegation entry carrying the actual output.
      research_agent: {
        stateFromResult: makeSubagentStateFromResult("research_agent"),
      },
      writing_agent: {
        stateFromResult: makeSubagentStateFromResult("writing_agent"),
      },
      critique_agent: {
        stateFromResult: makeSubagentStateFromResult("critique_agent"),
      },
    },
  };

  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: SYSTEM_PROMPT,
    tools: SHOWCASE_TOOLS,
  });

  return new StrandsAgent({
    agent: strandsAgent,
    name: "strands_agent",
    description:
      "A polished CopilotKit demo assistant: chat, tools, shared state, HITL, sub-agents.",
    config,
  });
}

/** Tool-free agent for the voice demo (transcription + basic chat). */
export async function buildVoiceAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: VOICE_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "voice_agent",
    description: "Simple assistant for the voice demo — no tools.",
  });
}

/** Tool-free hashbrown UI-kit envelope generator (declarative-hashbrown). */
export async function buildByocHashbrownAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: BYOC_HASHBROWN_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "byoc_hashbrown",
    description:
      "Hashbrown UI-kit envelope generator for the declarative-hashbrown demo.",
  });
}

/** Tool-free json-render flat-spec generator (declarative-json-render). */
export async function buildByocJsonRenderAgent(): Promise<StrandsAgent> {
  const strandsAgent = new Agent({
    model: await createModel(),
    systemPrompt: BYOC_JSON_RENDER_SYSTEM_PROMPT,
    tools: [],
  });
  return new StrandsAgent({
    agent: strandsAgent,
    name: "byoc_json_render",
    description:
      "json-render flat-spec generator for the declarative-json-render demo.",
  });
}
