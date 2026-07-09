"use client";

// Shared State (Read-only) — the UI publishes a recipe to the agent via
// `agent.setState`; the agent reads that recipe on every turn but does
// not mutate it (the wired graph is the neutral default agent with no
// tools — see manifest entry `shared-state-read`).
//
// Single source of truth: `agent.state.recipe`. The form is a pure
// controlled component on top of that — every edit flows straight into
// `agent.setState({...})` and the next render reflects it.

import React, { useEffect } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { RecipeCard } from "./recipe-card";
import { INITIAL_RECIPE } from "./types";
import type { RecipeAgentState, RecipeData } from "./types";

export default function SharedStateReadDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read">
      {/*
        Reserve the CopilotSidebar's column so the recipe card clears it.
        NOTE: this does NOT double-reserve — the framework's own reservation is
        inert here. The v2 `CopilotSidebar defaultOpen` is a FIXED overlay
        pinned right (480px) and also sets `body { margin-inline-end: 480px }`
        to reserve its column; but this showcase gives `body` an explicit
        full-viewport width, so that margin OVERFLOWS the viewport instead of
        narrowing the body content box. Measured at a 1280px viewport: body
        width = 1280px (not 800), body margin-inline-end = 480px, and this
        `w-full` wrapper resolves to the full 1280px — so the `mx-auto` card
        centers against the FULL viewport and its right-aligned "+ Add
        Ingredient" control lands UNDER the fixed sidebar (without this padding
        the button center hit-tests to the sidebar overlay and the e2e click is
        intercepted). `lg:pr-[480px]` reserves the column at the content level
        (border-box), centering the card in the visible ~800px region (measured
        card width ~640px — it does not stack with the inert body margin). The
        page is otherwise identical to the langgraph-python baseline, which has
        the same latent issue — see PARITY_NOTES.
      */}
      <div className="min-h-screen w-full bg-gray-50 lg:pr-[480px]">
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

  // Seed the initial recipe into agent state once so the agent has
  // something to read on the first turn. After this, every edit lands
  // via `agent.setState` below.
  useEffect(() => {
    if (!(agent.state as RecipeAgentState | undefined)?.recipe) {
      agent.setState({ recipe: INITIAL_RECIPE } satisfies RecipeAgentState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
