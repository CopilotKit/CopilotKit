// Shape of the recipe the UI writes into agent state via `agent.setState`.
// The agent only *reads* this — the wired graph is the neutral default
// chat agent (no backend tool), so the UI is the single source of truth.

export enum SkillLevel {
  BEGINNER = "Beginner",
  INTERMEDIATE = "Intermediate",
  ADVANCED = "Advanced",
}

export enum CookingTime {
  FiveMin = "5 min",
  FifteenMin = "15 min",
  ThirtyMin = "30 min",
  FortyFiveMin = "45 min",
  SixtyPlusMin = "60+ min",
}

export const cookingTimeValues = [
  { label: CookingTime.FiveMin, value: 0 },
  { label: CookingTime.FifteenMin, value: 1 },
  { label: CookingTime.ThirtyMin, value: 2 },
  { label: CookingTime.FortyFiveMin, value: 3 },
  { label: CookingTime.SixtyPlusMin, value: 4 },
];

export enum SpecialPreferences {
  HighProtein = "High Protein",
  LowCarb = "Low Carb",
  Spicy = "Spicy",
  BudgetFriendly = "Budget-Friendly",
  OnePotMeal = "One-Pot Meal",
  Vegetarian = "Vegetarian",
  Vegan = "Vegan",
}

export interface Ingredient {
  icon: string;
  name: string;
  amount: string;
}

export interface RecipeData {
  title: string;
  skill_level: SkillLevel;
  cooking_time: CookingTime;
  special_preferences: string[];
  ingredients: Ingredient[];
  instructions: string[];
}

export interface RecipeAgentState {
  recipe: RecipeData;
}

export const INITIAL_RECIPE: RecipeData = {
  title: "Make Your Recipe",
  skill_level: SkillLevel.INTERMEDIATE,
  cooking_time: CookingTime.FortyFiveMin,
  special_preferences: [],
  ingredients: [
    { icon: "🥕", name: "Carrots", amount: "3 large, grated" },
    { icon: "🌾", name: "All-Purpose Flour", amount: "2 cups" },
  ],
  instructions: ["Preheat oven to 350°F (175°C)"],
};
