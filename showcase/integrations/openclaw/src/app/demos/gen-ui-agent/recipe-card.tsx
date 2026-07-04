"use client";

import React from "react";

// Self-contained generative-UI component for the gen-ui-agent demo (OpenClaw).
//
// The OpenClaw agent calls the `generate_recipe` tool; its structured output
// (title, meta, ingredients, steps) is rendered here as a rich recipe card
// via `useRenderTool` in page.tsx. This cell inlines its own types, JSON
// parsing, and Tailwind styling — no cross-cell or `@/components` imports.

export type RecipeStatus = "inProgress" | "executing" | "complete";

export interface Recipe {
  title?: string;
  description?: string;
  servings?: number;
  prep_minutes?: number;
  cook_minutes?: number;
  ingredients?: string[];
  steps?: string[];
}

export function RecipeCard({
  loading,
  recipe,
}: {
  loading: boolean;
  recipe: Recipe;
}) {
  const title = recipe.title ?? "Generating recipe…";
  const ingredients = recipe.ingredients ?? [];
  const steps = recipe.steps ?? [];

  return (
    <div
      data-testid="recipe-card"
      data-loading={loading ? "true" : "false"}
      className="my-3 overflow-hidden rounded-2xl border border-[#DBDBE5] bg-white shadow-sm"
    >
      <div className="border-b border-[#E9E9EF] bg-[#FAFAFC] px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
            Recipe
          </span>
          {loading && <SpinnerIcon />}
        </div>
        <h3
          data-testid="recipe-title"
          className="mt-1 text-lg font-semibold text-[#010507]"
        >
          {title}
        </h3>
        {recipe.description && (
          <p className="mt-1 text-sm text-[#57575B]">{recipe.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {typeof recipe.servings === "number" && (
            <MetaPill label="Serves" value={String(recipe.servings)} />
          )}
          {typeof recipe.prep_minutes === "number" && (
            <MetaPill label="Prep" value={`${recipe.prep_minutes} min`} />
          )}
          {typeof recipe.cook_minutes === "number" && (
            <MetaPill label="Cook" value={`${recipe.cook_minutes} min`} />
          )}
        </div>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div>
          <SectionLabel>Ingredients</SectionLabel>
          {ingredients.length > 0 ? (
            <ul data-testid="recipe-ingredients" className="space-y-1.5">
              {ingredients.map((item, idx) => (
                <li
                  key={idx}
                  data-testid="recipe-ingredient"
                  className="flex items-start gap-2 text-sm text-[#010507]"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-[#85ECCE]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-[#838389]">gathering ingredients…</p>
          )}
        </div>

        <div>
          <SectionLabel>Steps</SectionLabel>
          {steps.length > 0 ? (
            <ol data-testid="recipe-steps" className="space-y-2.5">
              {steps.map((step, idx) => (
                <li
                  key={idx}
                  data-testid="recipe-step"
                  className="flex items-start gap-3 text-sm text-[#010507]"
                >
                  <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[#DBDBE5] bg-white text-[10px] font-semibold text-[#57575B]">
                    {idx + 1}
                  </span>
                  <span className="leading-5">{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs italic text-[#838389]">writing steps…</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[#E9E9EF] bg-white px-2.5 py-1 text-[11px] text-[#57575B]">
      <span className="text-[#838389]">{label}</span>{" "}
      <span className="font-medium text-[#010507]">{value}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#838389]">
      {children}
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-[#838389]"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
