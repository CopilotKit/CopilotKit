"use client";

import React, { useState, useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
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
      {
        title: "Suggest variations",
        message: "Suggest some creative variations of this recipe.",
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
  const [editingInstructionIndex, setEditingInstructionIndex] = useState<
    number | null
  >(null);
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

  // Sync agent state changes into local recipe state
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

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateRecipe({ title: event.target.value });
  };

  const handleSkillLevelChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    updateRecipe({ skill_level: event.target.value as SkillLevel });
  };

  const handleDietaryChange = (preference: string, checked: boolean) => {
    if (checked) {
      updateRecipe({
        special_preferences: [...recipe.special_preferences, preference],
      });
    } else {
      updateRecipe({
        special_preferences: recipe.special_preferences.filter(
          (p) => p !== preference,
        ),
      });
    }
  };

  const handleCookingTimeChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    updateRecipe({
      cooking_time: cookingTimeValues[Number(event.target.value)].label,
    });
  };

  const addIngredient = () => {
    updateRecipe({
      ingredients: [
        ...recipe.ingredients,
        { icon: "🍴", name: "", amount: "" },
      ],
    });
  };

  const updateIngredient = (
    index: number,
    field: keyof Ingredient,
    value: string,
  ) => {
    const updatedIngredients = [...recipe.ingredients];
    updatedIngredients[index] = {
      ...updatedIngredients[index],
      [field]: value,
    };
    updateRecipe({ ingredients: updatedIngredients });
  };

  const removeIngredient = (index: number) => {
    const updatedIngredients = [...recipe.ingredients];
    updatedIngredients.splice(index, 1);
    updateRecipe({ ingredients: updatedIngredients });
  };

  const addInstruction = () => {
    const newIndex = recipe.instructions.length;
    updateRecipe({ instructions: [...recipe.instructions, ""] });
    setEditingInstructionIndex(newIndex);
  };

  const updateInstruction = (index: number, value: string) => {
    const updatedInstructions = [...recipe.instructions];
    updatedInstructions[index] = value;
    updateRecipe({ instructions: updatedInstructions });
  };

  const removeInstruction = (index: number) => {
    const updatedInstructions = [...recipe.instructions];
    updatedInstructions.splice(index, 1);
    updateRecipe({ instructions: updatedInstructions });
  };

  return (
    <form
      data-testid="recipe-card"
      className="max-w-2xl mx-auto p-6 bg-white rounded-2xl shadow-lg border border-gray-100"
    >
      {/* Recipe Title */}
      <div className="mb-6">
        <input
          type="text"
          value={recipe.title || ""}
          onChange={handleTitleChange}
          className="text-3xl font-bold w-full border-none outline-none bg-transparent"
        />

        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1">
            <span>🕒</span>
            <select
              className="text-sm border rounded px-2 py-1"
              value={
                cookingTimeValues.find((t) => t.label === recipe.cooking_time)
                  ?.value || 3
              }
              onChange={handleCookingTimeChange}
            >
              {cookingTimeValues.map((time) => (
                <option key={time.value} value={time.value}>
                  {time.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span>🏆</span>
            <select
              className="text-sm border rounded px-2 py-1"
              value={recipe.skill_level}
              onChange={handleSkillLevelChange}
            >
              {Object.values(SkillLevel).map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Dietary Preferences */}
      <div className="mb-6 relative">
        {changedKeysRef.current.includes("special_preferences") && <Ping />}
        <h2 className="text-lg font-semibold mb-2">Dietary Preferences</h2>
        <div className="flex flex-wrap gap-2">
          {Object.values(SpecialPreferences).map((option) => (
            <label
              key={option}
              className="flex items-center gap-1 text-sm bg-gray-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-gray-100"
            >
              <input
                type="checkbox"
                checked={recipe.special_preferences.includes(option)}
                onChange={(e) => handleDietaryChange(option, e.target.checked)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Ingredients */}
      <div className="mb-6 relative">
        {changedKeysRef.current.includes("ingredients") && <Ping />}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Ingredients</h2>
          <button
            data-testid="add-ingredient-button"
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800"
            onClick={addIngredient}
          >
            + Add Ingredient
          </button>
        </div>
        <div data-testid="ingredients-container" className="space-y-2">
          {recipe.ingredients.map((ingredient, index) => (
            <div
              key={index}
              data-testid="ingredient-card"
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
            >
              <div className="text-2xl">{ingredient.icon || "🍴"}</div>
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={ingredient.name || ""}
                  onChange={(e) =>
                    updateIngredient(index, "name", e.target.value)
                  }
                  placeholder="Ingredient name"
                  className="flex-1 text-sm border rounded px-2 py-1"
                />
                <input
                  type="text"
                  value={ingredient.amount || ""}
                  onChange={(e) =>
                    updateIngredient(index, "amount", e.target.value)
                  }
                  placeholder="Amount"
                  className="w-32 text-sm border rounded px-2 py-1"
                />
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-red-500 text-xl"
                onClick={() => removeIngredient(index)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="mb-6 relative">
        {changedKeysRef.current.includes("instructions") && <Ping />}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Instructions</h2>
          <button
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800"
            onClick={addInstruction}
          >
            + Add Step
          </button>
        </div>
        <div data-testid="instructions-container" className="space-y-3">
          {recipe.instructions.map((instruction, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
                {index + 1}
              </div>
              <div
                className="flex-1 relative"
                onClick={() => setEditingInstructionIndex(index)}
              >
                <textarea
                  className="w-full text-sm border rounded px-3 py-2 resize-none"
                  value={instruction || ""}
                  onChange={(e) => updateInstruction(index, e.target.value)}
                  placeholder="Enter cooking instruction..."
                  onFocus={() => setEditingInstructionIndex(index)}
                  onBlur={() => setEditingInstructionIndex(null)}
                  rows={2}
                />
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-red-500 text-xl mt-1"
                onClick={() => removeInstruction(index)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Improve with AI Button */}
      <div className="flex justify-center">
        <button
          data-testid="improve-button"
          className={`px-6 py-3 rounded-xl font-semibold text-white transition-all ${
            isLoading
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 shadow-lg"
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

function Ping() {
  return (
    <span className="absolute -top-1 -right-1 flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
    </span>
  );
}
