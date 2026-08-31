import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextPanelComponent } from "./context-panel.component";
import { DocumentPanelComponent } from "./document-panel.component";
import { PreferencesPanelComponent } from "./preferences-panel.component";
import { RecipePanelComponent } from "./recipe-panel.component";
import { INITIAL_PREFERENCES, INITIAL_RECIPE } from "./state-model";

describe("Angular state feature panels", () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("emits an immutable preference update from the controlled form", () => {
    const fixture = TestBed.createComponent(PreferencesPanelComponent);
    fixture.componentRef.setInput("value", INITIAL_PREFERENCES);
    const listener = vi.fn();
    fixture.componentInstance.valueChange.subscribe(listener);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="pref-name"]',
    ) as HTMLInputElement;
    input.value = "Jamie";
    input.dispatchEvent(new Event("input"));

    expect(listener).toHaveBeenCalledWith({
      ...INITIAL_PREFERENCES,
      name: "Jamie",
    });
    expect(INITIAL_PREFERENCES.name).toBe("");
  });

  it("emits a recipe with an appended ingredient row", () => {
    const fixture = TestBed.createComponent(RecipePanelComponent);
    fixture.componentRef.setInput("recipe", INITIAL_RECIPE);
    const listener = vi.fn();
    fixture.componentInstance.recipeChange.subscribe(listener);
    fixture.detectChanges();

    fixture.nativeElement
      .querySelector('[data-testid="add-ingredient-button"]')
      .click();

    expect(listener).toHaveBeenCalledWith({
      ...INITIAL_RECIPE,
      ingredients: [
        ...INITIAL_RECIPE.ingredients,
        { icon: "🍴", name: "", amount: "" },
      ],
    });
  });

  it("renders streaming document status and count", () => {
    const fixture = TestBed.createComponent(DocumentPanelComponent);
    fixture.componentRef.setInput("content", "Draft");
    fixture.componentRef.setInput("isStreaming", true);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="document-char-count"]')
        .textContent,
    ).toContain("5 chars");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="document-live-badge"]',
      ),
    ).not.toBeNull();
  });

  it("publishes edited context and preserves accessible checkbox state", () => {
    const fixture = TestBed.createComponent(ContextPanelComponent);
    fixture.componentRef.setInput("userName", "Atai");
    fixture.componentRef.setInput("timezone", "America/Los_Angeles");
    fixture.componentRef.setInput("recentActivity", [
      "Viewed the pricing page",
      "Watched the product demo video",
    ]);
    const listener = vi.fn();
    fixture.componentInstance.nameChange.subscribe(listener);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="ctx-name"]',
    ) as HTMLInputElement;
    input.value = "Jamie";
    input.dispatchEvent(new Event("input"));

    expect(listener).toHaveBeenCalledWith("Jamie");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="activity-viewed-the-pricing-page"] input',
      ).checked,
    ).toBe(true);
  });
});
