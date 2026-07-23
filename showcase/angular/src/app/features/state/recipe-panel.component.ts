import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import type { Ingredient, Recipe } from "./state-model";
import { toggleValue } from "./state-model";

const PREFERENCES = [
  "High Protein",
  "Low Carb",
  "Spicy",
  "Budget-Friendly",
  "One-Pot Meal",
  "Vegetarian",
  "Vegan",
] as const;

@Component({
  selector: "showcase-recipe-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form data-testid="recipe-card" (submit)="$event.preventDefault()">
      <header>
        <p class="eyebrow">AI Recipe Assistant</p>
        <input
          aria-label="Recipe title"
          [value]="recipe().title"
          (input)="setTitle($event)"
        />
        <div class="field-grid">
          <label
            >Cooking time
            <select
              aria-label="Cooking time"
              [value]="recipe().cooking_time"
              (change)="setCookingTime($event)"
            >
              @for (time of cookingTimes; track time) {
                <option [value]="time">{{ time }}</option>
              }
            </select>
          </label>
          <label
            >Skill level
            <select
              aria-label="Skill level"
              [value]="recipe().skill_level"
              (change)="setSkillLevel($event)"
            >
              @for (level of skillLevels; track level) {
                <option [value]="level">{{ level }}</option>
              }
            </select>
          </label>
        </div>
      </header>

      <fieldset>
        <legend>Dietary Preferences</legend>
        <div class="choice-list">
          @for (preference of preferences; track preference) {
            <button
              type="button"
              [class.selected]="recipe().special_preferences.includes(preference)"
              [attr.aria-pressed]="
                recipe().special_preferences.includes(preference)
              "
              (click)="togglePreference(preference)"
            >
              {{ preference }}
            </button>
          }
        </div>
      </fieldset>

      <section aria-labelledby="ingredients-heading">
        <div class="section-heading">
          <h2 id="ingredients-heading">Ingredients</h2>
          <button
            data-testid="add-ingredient-button"
            type="button"
            (click)="addIngredient()"
          >
            + Add Ingredient
          </button>
        </div>
        <div data-testid="ingredients-container" class="rows">
          @for (ingredient of recipe().ingredients; track $index) {
            <div data-testid="ingredient-card" class="ingredient-row">
              <span aria-hidden="true">{{ ingredient.icon || "🍴" }}</span>
              <input
                [attr.aria-label]="'Ingredient ' + ($index + 1) + ' name'"
                placeholder="Ingredient name"
                [value]="ingredient.name"
                (input)="setIngredient($index, 'name', $event)"
              />
              <input
                [attr.aria-label]="'Ingredient ' + ($index + 1) + ' amount'"
                placeholder="Amount"
                [value]="ingredient.amount"
                (input)="setIngredient($index, 'amount', $event)"
              />
              <button
                type="button"
                [attr.aria-label]="'Remove ingredient ' + ($index + 1)"
                (click)="removeIngredient($index)"
              >
                ×
              </button>
            </div>
          }
        </div>
      </section>

      <section aria-labelledby="instructions-heading">
        <div class="section-heading">
          <h2 id="instructions-heading">Instructions</h2>
          <button type="button" (click)="addInstruction()">+ Add Step</button>
        </div>
        <div data-testid="instructions-container" class="rows">
          @for (instruction of recipe().instructions; track $index) {
            <div class="instruction-row">
              <span aria-hidden="true">{{ $index + 1 }}</span>
              <textarea
                [attr.aria-label]="'Instruction ' + ($index + 1)"
                [value]="instruction"
                (input)="setInstruction($index, $event)"
              ></textarea>
              <button
                type="button"
                [attr.aria-label]="'Remove step ' + ($index + 1)"
                (click)="removeInstruction($index)"
              >
                ×
              </button>
            </div>
          }
        </div>
      </section>

      <button
        data-testid="improve-button"
        class="improve"
        type="button"
        [disabled]="isRunning()"
        (click)="improve.emit()"
      >
        {{ isRunning() ? "Please Wait..." : "✦ Improve with AI" }}
      </button>
    </form>
  `,
  styles: `
    form {
      display: grid;
      gap: 1.25rem;
      padding: 1.25rem;
      border: 1px solid #dbe3eb;
      background: #fff;
    }
    header {
      display: grid;
      gap: 0.75rem;
    }
    .eyebrow {
      margin: 0;
      color: #52637a;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    header > input {
      border: 0;
      border-bottom: 1px solid #dbe3eb;
      color: #14213d;
      font-size: clamp(1.5rem, 3vw, 2.2rem);
      font-weight: 700;
    }
    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
    }
    label {
      display: grid;
      gap: 0.35rem;
      color: #31465e;
      font-size: 0.78rem;
      font-weight: 700;
    }
    input,
    select,
    textarea {
      min-height: 2.5rem;
      padding: 0.55rem 0.7rem;
      border: 1px solid #9fb3c8;
      border-radius: 0.35rem;
      background: #fff;
      font: inherit;
    }
    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend,
    h2 {
      color: #14213d;
      font-size: 0.95rem;
      font-weight: 700;
    }
    h2 {
      margin: 0;
    }
    .choice-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.5rem;
    }
    button {
      padding: 0.42rem 0.7rem;
      border: 1px solid #9fb3c8;
      border-radius: 0.35rem;
      color: #31465e;
      background: #fff;
      cursor: pointer;
    }
    .choice-list button {
      border-radius: 999px;
    }
    button.selected,
    .improve {
      color: #fff;
      border-color: #1d4ed8;
      background: #1d4ed8;
    }
    :is(input, select, textarea, button):focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .rows {
      display: grid;
      gap: 0.55rem;
      margin-top: 0.6rem;
    }
    .ingredient-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) minmax(7rem, 0.45fr) auto;
      align-items: center;
      gap: 0.55rem;
    }
    .ingredient-row > span {
      font-size: 1.5rem;
    }
    .instruction-row {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr) auto;
      align-items: start;
      gap: 0.55rem;
    }
    .instruction-row > span {
      display: grid;
      width: 1.8rem;
      height: 1.8rem;
      place-items: center;
      border-radius: 50%;
      color: #fff;
      background: #1d4ed8;
    }
    textarea {
      min-height: 4rem;
      resize: vertical;
    }
    .improve {
      justify-self: center;
      padding: 0.65rem 1rem;
    }
    .improve:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    @media (max-width: 44rem) {
      .field-grid {
        grid-template-columns: 1fr;
      }
      .ingredient-row {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }
      .ingredient-row input:nth-of-type(2) {
        grid-column: 2;
      }
    }
  `,
})
export class RecipePanelComponent {
  readonly recipe = input.required<Recipe>();
  readonly isRunning = input(false);
  readonly recipeChange = output<Recipe>();
  readonly improve = output<void>();
  protected readonly cookingTimes: Recipe["cooking_time"][] = [
    "5 min",
    "15 min",
    "30 min",
    "45 min",
    "60+ min",
  ];
  protected readonly skillLevels: Recipe["skill_level"][] = [
    "Beginner",
    "Intermediate",
    "Advanced",
  ];
  protected readonly preferences = PREFERENCES;

  protected setTitle(event: Event): void {
    this.patch({ title: valueOf(event) });
  }

  protected setCookingTime(event: Event): void {
    this.patch({ cooking_time: valueOf(event) as Recipe["cooking_time"] });
  }

  protected setSkillLevel(event: Event): void {
    this.patch({ skill_level: valueOf(event) as Recipe["skill_level"] });
  }

  protected togglePreference(preference: string): void {
    this.patch({
      special_preferences: toggleValue(
        this.recipe().special_preferences,
        preference,
      ),
    });
  }

  protected addIngredient(): void {
    this.patch({
      ingredients: [
        ...this.recipe().ingredients,
        { icon: "🍴", name: "", amount: "" },
      ],
    });
  }

  protected setIngredient(
    index: number,
    field: keyof Ingredient,
    event: Event,
  ): void {
    const ingredients = this.recipe().ingredients.map((ingredient, candidate) =>
      candidate === index
        ? { ...ingredient, [field]: valueOf(event) }
        : ingredient,
    );
    this.patch({ ingredients });
  }

  protected removeIngredient(index: number): void {
    this.patch({
      ingredients: this.recipe().ingredients.filter(
        (_, candidate) => candidate !== index,
      ),
    });
  }

  protected addInstruction(): void {
    this.patch({ instructions: [...this.recipe().instructions, ""] });
  }

  protected setInstruction(index: number, event: Event): void {
    const instructions = this.recipe().instructions.map(
      (instruction, candidate) =>
        candidate === index ? valueOf(event) : instruction,
    );
    this.patch({ instructions });
  }

  protected removeInstruction(index: number): void {
    this.patch({
      instructions: this.recipe().instructions.filter(
        (_, candidate) => candidate !== index,
      ),
    });
  }

  private patch(change: Partial<Recipe>): void {
    this.recipeChange.emit({ ...this.recipe(), ...change });
  }
}

function valueOf(event: Event): string {
  return (
    event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ).value;
}
