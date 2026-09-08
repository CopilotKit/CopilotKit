export type PreferenceTone = "formal" | "casual" | "playful";

export interface Preferences {
  name: string;
  tone: PreferenceTone;
  language: string;
  interests: string[];
}

export interface ReadWriteState {
  preferences: Preferences;
  notes: string[];
}

export interface Ingredient {
  icon: string;
  name: string;
  amount: string;
}

export interface Recipe {
  title: string;
  skill_level: "Beginner" | "Intermediate" | "Advanced";
  cooking_time: "5 min" | "15 min" | "30 min" | "45 min" | "60+ min";
  special_preferences: string[];
  ingredients: Ingredient[];
  instructions: string[];
}

export const INITIAL_PREFERENCES: Preferences = {
  name: "",
  tone: "casual",
  language: "English",
  interests: [],
};

export const INITIAL_RECIPE: Recipe = {
  title: "Make Your Recipe",
  skill_level: "Intermediate",
  cooking_time: "45 min",
  special_preferences: [],
  ingredients: [
    { icon: "🥕", name: "Carrots", amount: "3 large, grated" },
    { icon: "🌾", name: "All-Purpose Flour", amount: "2 cups" },
  ],
  instructions: ["Preheat oven to 350°F (175°C)"],
};

/** Parse bidirectional agent state without trusting backend payload shapes. */
export function readWriteState(value: unknown): ReadWriteState {
  if (!isRecord(value)) {
    return { preferences: INITIAL_PREFERENCES, notes: [] };
  }

  return {
    preferences: readPreferences(value["preferences"]),
    notes: readStringArray(value["notes"]),
  };
}

/** Parse the recipe slot, falling back atomically when any field is invalid. */
export function readRecipeState(value: unknown): Recipe {
  if (!isRecord(value) || !isRecord(value["recipe"])) return INITIAL_RECIPE;
  const recipe = value["recipe"];
  if (
    typeof recipe["title"] !== "string" ||
    !isSkillLevel(recipe["skill_level"]) ||
    !isCookingTime(recipe["cooking_time"]) ||
    !Array.isArray(recipe["special_preferences"]) ||
    !recipe["special_preferences"].every(isString) ||
    !Array.isArray(recipe["ingredients"]) ||
    !recipe["ingredients"].every(isIngredient) ||
    !Array.isArray(recipe["instructions"]) ||
    !recipe["instructions"].every(isString)
  ) {
    return INITIAL_RECIPE;
  }

  return {
    title: recipe["title"],
    skill_level: recipe["skill_level"],
    cooking_time: recipe["cooking_time"],
    special_preferences: [...recipe["special_preferences"]],
    ingredients: recipe["ingredients"].map((ingredient) => ({ ...ingredient })),
    instructions: [...recipe["instructions"]],
  };
}

/** Read the streamed document slot while rejecting non-text payloads. */
export function readDocumentState(value: unknown): string {
  return isRecord(value) && typeof value["document"] === "string"
    ? value["document"]
    : "";
}

/** Return a new list with a selected value toggled. */
export function toggleValue(
  values: readonly string[],
  value: string,
): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function readPreferences(value: unknown): Preferences {
  if (
    !isRecord(value) ||
    typeof value["name"] !== "string" ||
    !isPreferenceTone(value["tone"]) ||
    typeof value["language"] !== "string" ||
    !Array.isArray(value["interests"]) ||
    !value["interests"].every(isString)
  ) {
    return INITIAL_PREFERENCES;
  }
  return {
    name: value["name"],
    tone: value["tone"],
    language: value["language"],
    interests: [...value["interests"]],
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every(isString) ? [...value] : [];
}

function isIngredient(value: unknown): value is Ingredient {
  return (
    isRecord(value) &&
    typeof value["icon"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["amount"] === "string"
  );
}

function isPreferenceTone(value: unknown): value is PreferenceTone {
  return value === "formal" || value === "casual" || value === "playful";
}

function isSkillLevel(value: unknown): value is Recipe["skill_level"] {
  return (
    value === "Beginner" || value === "Intermediate" || value === "Advanced"
  );
}

function isCookingTime(value: unknown): value is Recipe["cooking_time"] {
  return (
    value === "5 min" ||
    value === "15 min" ||
    value === "30 min" ||
    value === "45 min" ||
    value === "60+ min"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
