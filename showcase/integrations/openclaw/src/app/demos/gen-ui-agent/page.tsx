"use client";

// Agentic Generative UI — Tool-Call-Driven Rendering (OpenClaw).
//
// The OpenClaw agent calls a single structured tool, `generate_recipe`. Its
// output — title, meta, ingredients, and steps — is rendered as a rich recipe
// card via `useRenderTool` (a per-tool renderer keyed by name), NOT as a
// generic tool-call card. This is the "generative UI from a tool call's
// output" pattern: the agent decides WHAT to render by choosing which tool to
// call and with what arguments; the frontend owns HOW it looks.
//
// clawg-ui streams TOOL_CALL_START/ARGS/END over AG-UI, and CopilotChat drives
// the card through its inProgress → executing → complete lifecycle. The card
// paints from the tool ARGUMENTS as they stream, so the rich UI appears on the
// first tool call (there is no separate tool result needed to render).

// @region[render-recipe-tool]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { RecipeCard, type Recipe } from "./recipe-card";
import { useSuggestions } from "./suggestions";

export default function GenUiAgentDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-agent">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Frontend tool: `generate_recipe` is DEFINED here so it's forwarded to the
  // OpenClaw agent over AG-UI (RunAgentInput.tools → clawg-ui clientTools).
  // When the agent calls it, its `render` paints the branded RecipeCard
  // directly from the streamed tool arguments — the rich UI appears on the
  // first tool call, no tool result round-trip. (No `handler`: render-only.)
  useFrontendTool({
    name: "generate_recipe",
    description:
      "Generate a structured recipe. Call this to answer any recipe request " +
      "with a rich recipe card instead of a plain-text reply.",
    parameters: z.object({
      title: z.string(),
      description: z.string().optional(),
      servings: z.number().optional(),
      prep_minutes: z.number().optional(),
      cook_minutes: z.number().optional(),
      ingredients: z.array(z.string()).optional(),
      steps: z.array(z.string()).optional(),
    }),
    render: ({ args, status }) => {
      const loading = status !== "complete";
      return <RecipeCard loading={loading} recipe={(args ?? {}) as Recipe} />;
    },
  });
  // @endregion[render-recipe-tool]

  useSuggestions();

  return (
    <CopilotChat agentId="gen-ui-agent" className="h-full rounded-2xl" />
  );
}
