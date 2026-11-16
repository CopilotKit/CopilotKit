"use client";

// Shared State (Read-only): the UI publishes a recipe to the agent with
// `agent.setState`. The agent reads that recipe on every turn, but it has no
// tool that changes it.
//
// Single source of truth: `agent.state.recipe`. The form is a controlled
// component on top of that state. Every edit goes straight into
// `agent.setState({...})`, and the next render shows it.

import React, { useEffect } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { RecipeCard } from "./recipe-card";
import { INITIAL_RECIPE } from "./types";
import type { RecipeAgentState, RecipeData } from "./types";

export default function SharedStateReadDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("shared-state-read")}
      agent="shared-state-read"
    >
      <div className="h-full w-full overflow-y-auto bg-gray-50 dark:bg-background">
        <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
          <Recipe />
        </div>
        <CopilotSidebar
          defaultOpen
          labels={{ modalHeaderTitle: "AI Recipe Assistant" }}
        />
      </div>
    </CopilotKit>
  );
}

function Recipe() {
  const { agent } = useAgent({
    agentId: "shared-state-read",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Create Italian recipe",
        message: "Create a delicious Italian pasta recipe.",
      },
      {
        title: "Make it healthier",
        message: "Make the recipe healthier with more vegetables.",
      },
      {
        title: "Suggest variations",
        message: "Suggest some creative variations of this recipe.",
      },
    ],
    available: "always",
  });

  // Seed the initial recipe into agent state, so the agent has something to
  // read on the first turn. After this, every edit goes through
  // `agent.setState` below.
  //
  // The effect depends on `agent`: while the runtime's /info request is in
  // flight, `useAgent` returns a provisional agent, and then it swaps in the
  // real agent. Only the real agent sends its state to the backend, so it
  // must be seeded too. The `recipe` check keeps the seed from overwriting
  // the user's edits.
  useEffect(() => {
    if (!(agent.state as RecipeAgentState | undefined)?.recipe) {
      agent.setState({ recipe: INITIAL_RECIPE } satisfies RecipeAgentState);
    }
  }, [agent]);

  const recipe =
    (agent.state as RecipeAgentState | undefined)?.recipe ?? INITIAL_RECIPE;

  const handleChange = (next: RecipeData) => {
    agent.setState({ recipe: next } satisfies RecipeAgentState);
  };

  const handleImprove = () => {
    if (agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: "Improve the recipe",
    });
    void copilotkit
      .runAgent({ agent })
      .catch((err) =>
        console.error("[shared-state-read] runAgent failed", err),
      );
  };

  return (
    <RecipeCard
      recipe={recipe}
      isLoading={agent.isRunning}
      onChange={handleChange}
      onImprove={handleImprove}
    />
  );
}
