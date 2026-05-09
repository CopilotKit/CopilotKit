"use client";

import React, { useState, useEffect, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import {
  CopilotKit,
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
  useCopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

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
    instructions: ["Preheat oven to 350°F (175°C)"],
  },
};

export default function SharedStateReadDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read">
      <div className="min-h-screen w-full bg-gray-50">
        <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
          <Recipe />
        </div>
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

  const handleSkillLevelChange = (level: string) => {
    updateRecipe({ skill_level: level as SkillLevel });
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

  const handleCookingTimeChange = (value: string) => {
    updateRecipe({
      cooking_time: cookingTimeValues[Number(value)].label,
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

  const cookingTimeIndex = String(
    cookingTimeValues.find((t) => t.label === recipe.cooking_time)?.value ?? 3,
  );

  return (
    <form data-testid="recipe-card">
      <Card className="gap-0 border-border/60 py-0 shadow-xs">
        <CardContent className="space-y-6 px-6 py-6 md:px-8 md:py-8">
          <header className="space-y-3">
            <Input
              type="text"
              value={recipe.title || ""}
              onChange={handleTitleChange}
              aria-label="Recipe title"
              className="h-auto border-0 bg-transparent px-0 py-1 text-2xl font-bold shadow-none focus-visible:ring-0 md:text-3xl"
            />

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span aria-hidden>🕒</span>
                <Select
                  value={cookingTimeIndex}
                  onValueChange={handleCookingTimeChange}
                >
                  <SelectTrigger size="sm" aria-label="Cooking time">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cookingTimeValues.map((time) => (
                      <SelectItem key={time.value} value={String(time.value)}>
                        {time.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span aria-hidden>🏆</span>
                <Select
                  value={recipe.skill_level}
                  onValueChange={handleSkillLevelChange}
                >
                  <SelectTrigger size="sm" aria-label="Skill level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(SkillLevel).map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </header>

          <Separator />

          <section className="relative space-y-3">
            {changedKeysRef.current.includes("special_preferences") && <Ping />}
            <h2 className="text-base font-semibold">Dietary Preferences</h2>
            <div className="flex flex-wrap gap-2">
              {Object.values(SpecialPreferences).map((option) => {
                const selected = recipe.special_preferences.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleDietaryChange(option, !selected)}
                    aria-pressed={selected}
                    className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Badge
                      variant={selected ? "default" : "outline"}
                      className="cursor-pointer px-3 py-1 text-sm"
                    >
                      {option}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </section>

          <Separator />

          <section className="relative space-y-3">
            {changedKeysRef.current.includes("ingredients") && <Ping />}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Ingredients</h2>
              <Button
                data-testid="add-ingredient-button"
                type="button"
                variant="ghost"
                size="sm"
                onClick={addIngredient}
              >
                + Add Ingredient
              </Button>
            </div>
            <div data-testid="ingredients-container" className="space-y-2">
              {recipe.ingredients.map((ingredient, index) => (
                <div
                  key={index}
                  data-testid="ingredient-card"
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3"
                >
                  <div className="shrink-0 text-2xl" aria-hidden>
                    {ingredient.icon || "🍴"}
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem]">
                    <Input
                      type="text"
                      value={ingredient.name || ""}
                      onChange={(e) =>
                        updateIngredient(index, "name", e.target.value)
                      }
                      placeholder="Ingredient name"
                    />
                    <Input
                      type="text"
                      value={ingredient.amount || ""}
                      onChange={(e) =>
                        updateIngredient(index, "amount", e.target.value)
                      }
                      placeholder="Amount"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove ingredient"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeIngredient(index)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section className="relative space-y-3">
            {changedKeysRef.current.includes("instructions") && <Ping />}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Instructions</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addInstruction}
              >
                + Add Step
              </Button>
            </div>
            <div data-testid="instructions-container" className="space-y-3">
              {recipe.instructions.map((instruction, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {index + 1}
                  </div>
                  <div
                    className="relative flex-1"
                    onClick={() => setEditingInstructionIndex(index)}
                  >
                    <Textarea
                      value={instruction || ""}
                      onChange={(e) => updateInstruction(index, e.target.value)}
                      placeholder="Enter cooking instruction..."
                      onFocus={() => setEditingInstructionIndex(index)}
                      onBlur={() => setEditingInstructionIndex(null)}
                      rows={2}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove step"
                    className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeInstruction(index)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <div className="flex justify-center">
            <Button
              data-testid="improve-button"
              type="button"
              size="lg"
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
              {isLoading ? (
                <>
                  <Spinner />
                  Please Wait...
                </>
              ) : (
                <>
                  <Sparkles />
                  Improve with AI
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function Ping() {
  return (
    <span className="absolute -top-1 -right-1 flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
    </span>
  );
}
