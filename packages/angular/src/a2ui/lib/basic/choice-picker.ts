import { Component, computed, input, signal } from "@angular/core";
import type { ChoicePickerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { uniqueId, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-choice-picker",
  template: `
    <div class="picker">
      @if (props().label) {
        <strong class="label">{{ props().label }}</strong>
      }
      @if (props().filterable) {
        <input
          #filterInput
          type="text"
          class="filter"
          placeholder="Filter options..."
          [value]="filter()"
          (input)="filter.set(filterInput.value)"
        />
      }
      <div class="options" [class.chips]="chips()">
        @for (option of options(); track option.value) {
          @if (chips()) {
            <button
              type="button"
              class="chip"
              [class.selected]="selected().includes(option.value)"
              (click)="toggle(option.value)"
            >
              {{ option.label }}
            </button>
          } @else {
            <label class="option">
              <input
                [type]="exclusive() ? 'radio' : 'checkbox'"
                [name]="exclusive() ? groupName : ''"
                [checked]="selected().includes(option.value)"
                (change)="toggle(option.value)"
              />
              <span class="option-label">{{ option.label }}</span>
            </label>
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .picker {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-m, 8px);
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
    }
    .label {
      font-size: var(--a2ui-font-size-s, 14px);
    }
    .filter {
      padding: 4px 8px;
      background-color: var(--a2ui-color-input, Field);
      color: var(--a2ui-color-on-input, FieldText);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 8px);
    }
    .options {
      display: flex;
      flex-direction: column;
      flex-wrap: nowrap;
      gap: var(--a2ui-spacing-m, 8px);
    }
    .options.chips {
      flex-direction: row;
      flex-wrap: wrap;
    }
    .chip {
      padding: 4px 12px;
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-chip-border-radius, 16px);
      background-color: var(--a2ui-color-surface, #fff);
      color: inherit;
      font-size: var(--a2ui-font-size-xs, 12px);
      cursor: pointer;
    }
    .chip.selected {
      border: 1px solid
        var(--a2ui-color-primary, var(--a2ui-primary-color, #007bff));
      background-color: var(
        --a2ui-color-primary,
        var(--a2ui-primary-color, #007bff)
      );
      color: var(--a2ui-color-on-primary, #fff);
    }
    .option {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-m, 8px);
      cursor: pointer;
    }
    .option-label {
      font-size: var(--a2ui-font-size-s, 14px);
    }
  `,
})
export class CopilotA2UIChoicePicker {
  readonly props = input.required<BasicProps<typeof ChoicePickerApi>>();
  /** Per instance, so template-spawned pickers never share a radio group. */
  protected readonly groupName = uniqueId("choice");
  protected readonly filter = signal("");
  protected readonly chips = computed(
    () => this.props().displayStyle === "chips",
  );
  protected readonly exclusive = computed(
    () => this.props().variant === "mutuallyExclusive",
  );
  protected readonly selected = computed((): string[] => {
    const value: unknown = this.props().value;
    return Array.isArray(value) ? value : [];
  });
  protected readonly options = computed(() => {
    const { options, filterable } = this.props();
    const filter = this.filter().toLowerCase();
    return (options ?? []).filter(
      (option) =>
        !filterable ||
        filter === "" ||
        String(option.label).toLowerCase().includes(filter),
    );
  });

  protected toggle(value: string): void {
    const selected = this.selected();
    this.props().setValue(
      this.exclusive()
        ? [value]
        : selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value],
    );
  }
}
