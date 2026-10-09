"use client";

import React from "react";
import { Sparkles, X } from "lucide-react";

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

import {
  cookingTimeValues,
  type Ingredient,
  type RecipeData,
  SkillLevel,
  SpecialPreferences,
} from "./types";

export interface RecipeCardProps {
  recipe: RecipeData;
  isLoading: boolean;
  onChange: (next: RecipeData) => void;
  onImprove: () => void;
}

export function RecipeCard({
  recipe,
  isLoading,
  onChange,
  onImprove,
}: RecipeCardProps) {
  const update = (partial: Partial<RecipeData>) => {
    onChange({ ...recipe, ...partial });
  };

  const updateIngredient = (
    index: number,
    field: keyof Ingredient,
    value: string,
  ) => {
    const next = [...recipe.ingredients];
    next[index] = { ...next[index], [field]: value };
    update({ ingredients: next });
  };

  const updateInstruction = (index: number, value: string) => {
    const next = [...recipe.instructions];
    next[index] = value;
    update({ instructions: next });
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
              onChange={(e) => update({ title: e.target.value })}
              aria-label="Recipe title"
              className="h-auto border-0 bg-transparent px-0 py-1 text-2xl font-bold shadow-none focus-visible:ring-0 md:text-3xl"
            />

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span aria-hidden>🕒</span>
                <Select
                  value={cookingTimeIndex}
                  onValueChange={(value) =>
                    update({
                      cooking_time: cookingTimeValues[Number(value)].label,
                    })
                  }
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
                  onValueChange={(value) =>
                    update({ skill_level: value as SkillLevel })
                  }
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

          <section className="space-y-3">
            <h2 className="text-base font-semibold">Dietary Preferences</h2>
            <div className="flex flex-wrap gap-2">
              {Object.values(SpecialPreferences).map((option) => {
                const selected = recipe.special_preferences.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      update({
                        special_preferences: selected
                          ? recipe.special_preferences.filter(
                              (p) => p !== option,
                            )
                          : [...recipe.special_preferences, option],
                      })
                    }
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

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Ingredients</h2>
              <Button
                data-testid="add-ingredient-button"
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({
                    ingredients: [
                      ...recipe.ingredients,
                      { icon: "🍴", name: "", amount: "" },
                    ],
                  })
                }
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
                    onClick={() =>
                      update({
                        ingredients: recipe.ingredients.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Instructions</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({ instructions: [...recipe.instructions, ""] })
                }
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
                  <div className="relative flex-1">
                    <Textarea
                      value={instruction || ""}
                      onChange={(e) => updateInstruction(index, e.target.value)}
                      placeholder="Enter cooking instruction..."
                      rows={2}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove step"
                    className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      update({
                        instructions: recipe.instructions.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
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
              onClick={onImprove}
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
