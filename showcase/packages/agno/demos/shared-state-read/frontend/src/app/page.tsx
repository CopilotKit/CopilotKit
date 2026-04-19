"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CopilotKit,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useCopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

enum SkillLevel {
  BEGINNER = "Beginner",
  INTERMEDIATE = "Intermediate",
  ADVANCED = "Advanced",
}

enum CookingTime {
  FiveMin = "5 min",
  FifteenMin = "15 min",
  ThirtyMin = "30 min",
  FortyFiveMin = "45 min",
  SixtyPlusMin = "60+ min",
}

const cookingTimeValues = [
  { label: CookingTime.FiveMin, value: 0 },
  { label: CookingTime.FifteenMin, value: 1 },
  { label: CookingTime.ThirtyMin, value: 2 },
  { label: CookingTime.FortyFiveMin, value: 3 },
  { label: CookingTime.SixtyPlusMin, value: 4 },
];

enum SpecialPreferences {
  HighProtein = "High Protein",
  LowCarb = "Low Carb",
  Spicy = "Spicy",
  BudgetFriendly = "Budget-Friendly",
  OnePotMeal = "One-Pot Meal",
  Vegetarian = "Vegetarian",
  Vegan = "Vegan",
}

interface Ingredient {
  icon: string;
  name: string;
  amount: string;
}

interface RecipeData {
  title: string;
  skill_level: SkillLevel;
  cooking_time: CookingTime;
  special_preferences: string[];
  ingredients: Ingredient[];
  instructions: string[];
}

interface RecipeAgentState {
  recipe: RecipeData;
}

const INITIAL_STATE: RecipeAgentState = {
  recipe: {
    title: "Make Your Recipe",
    skill_level: SkillLevel.INTERMEDIATE,
    cooking_time: CookingTime.FortyFiveMin,
    special_preferences: [],
    ingredients: [
      { icon: "🥕", name: "Carrots", amount: "3 large, grated" },
      { icon: "🌾", name: "All-Purpose Flour", amount: "2 cups" },
    ],
    instructions: ["Preheat oven to 350\u00B0F (175\u00B0C)"],
  },
};

export default function SharedStateReadDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read">
      <div className="min-h-screen w-full flex items-center justify-center">
        <Recipe />
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "AI Recipe Assistant",
          }}
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
    ],
    available: "always",
  });

  const agentState = agent.state as RecipeAgentState | undefined;
  const setAgentState = (s: RecipeAgentState) => agent.setState(s);
  const isLoading = agent.isRunning;

  useEffect(() => {
    if (!agentState?.recipe) {
      setAgentState(INITIAL_STATE);
    }
  }, []);

  const [recipe, setRecipe] = useState(INITIAL_STATE.recipe);
  const changedKeysRef = useRef<string[]>([]);

  const updateRecipe = (partialRecipe: Partial<RecipeData>) => {
    setAgentState({
      ...(agentState || INITIAL_STATE),
      recipe: {
        ...recipe,
        ...partialRecipe,
      },
    });
    setRecipe({
      ...recipe,
      ...partialRecipe,
    });
  };

  const newRecipeState = { ...recipe };
  const newChangedKeys: string[] = [];

  for (const key in recipe) {
    if (
      agentState?.recipe &&
      (agentState.recipe as any)[key] !== undefined &&
      (agentState.recipe as any)[key] !== null
    ) {
      let agentValue = (agentState.recipe as any)[key];
      const recipeValue = (recipe as any)[key];

      if (typeof agentValue === "string") {
        agentValue = agentValue.replace(/\\n/g, "\n");
      }

      if (JSON.stringify(agentValue) !== JSON.stringify(recipeValue)) {
        (newRecipeState as any)[key] = agentValue;
        newChangedKeys.push(key);
      }
    }
  }

  if (newChangedKeys.length > 0) {
    changedKeysRef.current = newChangedKeys;
  } else if (!isLoading) {
    changedKeysRef.current = [];
  }

  useEffect(() => {
    setRecipe(newRecipeState);
  }, [JSON.stringify(newRecipeState)]);

  return (
    <form
      data-testid="recipe-card"
      className="max-w-2xl mx-auto p-6 bg-white rounded-2xl shadow-lg border border-gray-100"
    >
      <div className="mb-6">
        <input
          type="text"
          value={recipe.title || ""}
          onChange={(e) => updateRecipe({ title: e.target.value })}
          className="text-3xl font-bold w-full border-none outline-none bg-transparent"
        />
      </div>
      <div data-testid="ingredients-container" className="space-y-2">
        {recipe.ingredients.map((ingredient, index) => (
          <div
            key={index}
            data-testid="ingredient-card"
            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
          >
            <div className="text-2xl">{ingredient.icon || "🍴"}</div>
            <div className="flex-1">{ingredient.name}</div>
            <div className="text-sm text-gray-500">{ingredient.amount}</div>
          </div>
        ))}
      </div>
      <div data-testid="instructions-container" className="mt-4 space-y-3">
        {recipe.instructions.map((instruction, index) => (
          <div key={index} className="flex items-start gap-3">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
              {index + 1}
            </div>
            <div className="flex-1">{instruction}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-center mt-4">
        <button
          data-testid="improve-button"
          className={`px-6 py-3 rounded-xl font-semibold text-white transition-all ${
            isLoading
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-500 hover:bg-blue-600"
          }`}
          type="button"
          onClick={() => {
            if (!isLoading) {
              agent.addMessage({
                id: crypto.randomUUID(),
                role: "user",
                content: "Improve the recipe",
              });
              copilotkit.runAgent({ agent });
            }
          }}
          disabled={isLoading}
        >
          {isLoading ? "Please Wait..." : "Improve with AI"}
        </button>
      </div>
    </form>
  );
}
