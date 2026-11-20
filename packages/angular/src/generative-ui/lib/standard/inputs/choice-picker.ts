import { Component, computed, input, signal } from "@angular/core";
import {
  backgroundColor,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  InputOptionList,
  choicePickerSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { StyleMap } from "../style";
import { radioOptionStyle } from "./choice";
import {
  CHECK_ERROR,
  CopilotGenerativeUIControl,
  FIELD_HOST,
  controlStyle,
  fieldStyle,
  normalizeOptions,
  uniqueId,
} from "./control";

type ChoicePickerProps = z.output<typeof choicePickerSchema>;

/**
 * One or more options from a list, as checkboxes (or radios, for one
 * choice) or as chips. The value is always a list of option values.
 */
@Component({
  selector: "div[copilotGenerativeUIChoicePicker]",
  template: `
    @if (label(); as label) {
      <span [id]="labelId" [style]="labelStyle">{{ label }}</span>
    }
    @if (filterable()) {
      <input
        type="search"
        data-a2ui-input
        aria-label="Filter options"
        placeholder="Filter…"
        [value]="filter()"
        [disabled]="disabled() ?? false"
        (input)="filter.set($any($event.target).value)"
        [style]="filterStyle()"
      />
    }
    @if (required()) {
      <!-- The checkboxes and chips carry no selection of their own, so this
           sentinel makes an empty required choice fail the Form's constraint
           validation. It is invisible and not in the tab order. -->
      <input
        tabindex="-1"
        aria-hidden="true"
        required
        [disabled]="disabled() ?? false"
        [value]="chosen().join(',')"
        style="position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; padding: 0; border: 0; pointer-events: none"
      />
    }
    <div
      [attr.role]="isChips() ? 'group' : isMultiple() ? 'group' : 'radiogroup'"
      [attr.aria-labelledby]="label() ? labelId : null"
      [attr.aria-required]="required() ? 'true' : null"
      [attr.aria-invalid]="state.invalid() ? 'true' : null"
      [style]="groupStyle()"
    >
      @for (option of shown(); track option.value) {
        @if (isChips()) {
          <button
            type="button"
            data-a2ui-input
            [attr.aria-pressed]="isSelected(option.value)"
            [disabled]="disabled() ?? false"
            (click)="toggle(option.value)"
            [style]="chipStyle(option.value)"
          >
            {{ option.label }}
          </button>
        } @else {
          <label [style]="listOptionStyle">
            <input
              [type]="isMultiple() ? 'checkbox' : 'radio'"
              class="a2ui-std-check"
              data-a2ui-input
              [attr.name]="groupName"
              [value]="option.value"
              [checked]="isSelected(option.value)"
              [disabled]="disabled() ?? false"
              (click)="onOptionClick(option.value)"
            />
            <span style="display: flex; flex-direction: column">
              <span>{{ option.label }}</span>
              @if (option.description) {
                <span [style]="smallStyle">{{ option.description }}</span>
              }
            </span>
          </label>
        }
      }
    </div>
    ${CHECK_ERROR}
  `,
  host: FIELD_HOST,
})
export class CopilotGenerativeUIChoicePicker extends CopilotGenerativeUIControl<
  string[]
> {
  readonly options = input<InputOptionList>();
  readonly label = input<string>();
  readonly variant = input<ChoicePickerProps["variant"]>();
  readonly displayStyle = input<ChoicePickerProps["displayStyle"]>();
  readonly filterable = input<boolean>();
  readonly weight = input<number>();

  protected readonly labelId = uniqueId("a2ui-choices");
  protected readonly groupName = uniqueId("a2ui-choice");
  protected readonly filter = signal("");
  protected readonly isMultiple = computed(
    () => this.variant() === "multipleSelection",
  );
  protected readonly isChips = computed(() => this.displayStyle() === "chips");
  protected readonly chosen = computed(() => {
    const value = this.value();
    return Array.isArray(value) ? value : [];
  });
  protected readonly optionList = computed(() =>
    normalizeOptions(this.options()),
  );
  protected readonly shown = computed(() => {
    const filter = this.filter().toLowerCase();
    const options = this.optionList();
    return filter
      ? options.filter((option) => option.label.toLowerCase().includes(filter))
      : options;
  });
  protected readonly hostStyle = computed(() => fieldStyle(this.weight()));
  protected readonly filterStyle = computed(() =>
    controlStyle({ disabled: this.disabled() }, "lg"),
  );
  protected readonly groupStyle = computed<StyleMap>(() => ({
    display: "flex",
    flexDirection: this.isChips() ? "row" : "column",
    flexWrap: this.isChips() ? "wrap" : undefined,
    gap: spacing(2),
    opacity: this.disabled() ? 0.5 : undefined,
  }));
  protected readonly listOptionStyle = radioOptionStyle("list", false);

  protected isSelected(optionValue: string) {
    return this.chosen().includes(optionValue);
  }

  protected chipStyle(optionValue: string): StyleMap {
    const isSelected = this.isSelected(optionValue);
    return {
      ...radioOptionStyle("pills", isSelected),
      background: isSelected
        ? backgroundColor("surface-secondary")
        : "transparent",
      color: textColor("default"),
      fontFamily: "inherit",
      cursor: this.disabled() ? "not-allowed" : "pointer",
    };
  }

  /** A click, not a change: a radio does not fire change when it is already checked. */
  protected onOptionClick(optionValue: string) {
    this.toggle(optionValue);
  }

  protected toggle(optionValue: string) {
    const chosen = this.chosen();
    if (!this.isMultiple()) {
      this.setValue(chosen.includes(optionValue) ? [] : [optionValue]);
      return;
    }
    this.setValue(
      chosen.includes(optionValue)
        ? chosen.filter((item) => item !== optionValue)
        : [...chosen, optionValue],
    );
  }
}
