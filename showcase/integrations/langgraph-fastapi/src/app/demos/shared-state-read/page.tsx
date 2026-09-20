"use client";

// Shared State (Read-only) — the UI owns the recipe and publishes its
// current values as agent context on every turn. Backend state snapshots
// cannot replace the form values with unrelated agent state.

import React, { useState } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useAgent,
  useAgentContext,
  UseAgentUpdate,
  useConfigureSuggestions,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { RecipeCard } from "./recipe-card";
import { INITIAL_RECIPE } from "./types";
import type { RecipeData } from "./types";

export default function SharedStateReadDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read">
      <div className="min-h-screen w-full bg-gray-50">
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
  const [recipe, setRecipe] = useState<RecipeData>(INITIAL_RECIPE);
  const { agent, isReady } = useAgent({
    agentId: "shared-state-read",
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();

  useAgentContext({
    description: "The current recipe displayed in the recipe editor",
    value: JSON.stringify(recipe),
  });

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

  const handleImprove = () => {
    if (!isReady || agent.isRunning) return;
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
      isLoading={!isReady || agent.isRunning}
      onChange={setRecipe}
      onImprove={handleImprove}
    />
  );
}
