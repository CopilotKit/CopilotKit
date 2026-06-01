"use client";

import { useEffect } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

type Recipe = {
  title: string;
  ingredients: { name: string; quantity: string }[];
  steps: string[];
};

const defaultRecipe: Recipe = {
  title: "Tomato Pasta",
  ingredients: [
    { name: "Pasta", quantity: "200g" },
    { name: "Tomato", quantity: "3 medium" },
  ],
  steps: ["Boil pasta", "Sauté tomato", "Combine"],
};

export default function SharedStateReadWrite() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  // @region[use-agent]
  // @region[use-agent-read]
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  // @endregion[use-agent-read]
  // @endregion[use-agent]

  useEffect(() => {
    if (!agent.state || Object.keys(agent.state).length === 0) {
      agent.state = { ...defaultRecipe } as unknown as typeof agent.state;
    }
  }, [agent]);

  const recipe = (agent.state as Partial<Recipe>) ?? {};
  const title = recipe.title ?? defaultRecipe.title;
  const ingredients = recipe.ingredients ?? defaultRecipe.ingredients;
  const steps = recipe.steps ?? defaultRecipe.steps;

  // @region[set-state]
  // @region[use-agent-write]
  function setTitle(next: string) {
    agent.state = {
      ...(agent.state as object),
      title: next,
    } as unknown as typeof agent.state;
  }
  // @endregion[use-agent-write]
  // @endregion[set-state]

  return (
    <main className="p-8 grid grid-cols-2 gap-8">
      <div>
        <h1 className="text-2xl font-semibold mb-4">
          Shared State (Read + Write)
        </h1>
        <p className="text-sm opacity-70 mb-4">
          Edit the title; the agent reads from <code>input.state</code>. Ask the
          agent to add an ingredient; it calls{" "}
          <code>AGUISendStateSnapshot</code> and the panel updates live.
        </p>
        <input
          type="text"
          className="border rounded p-2 w-full mb-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <h2 className="font-medium mt-4 mb-2">Ingredients</h2>
        <ul className="space-y-1 text-sm">
          {ingredients.map((ing, i) => (
            <li key={i}>
              {ing.quantity} {ing.name}
            </li>
          ))}
        </ul>
        <h2 className="font-medium mt-4 mb-2">Steps</h2>
        <ol className="space-y-1 text-sm list-decimal list-inside">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      <div>
        <CopilotChat />
      </div>
    </main>
  );
}
