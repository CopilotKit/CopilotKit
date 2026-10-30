import { Component, computed, input } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { textColor } from "@copilotkit/shared/generative-ui";
import type {
  InputOptionList,
  InputSize,
} from "@copilotkit/shared/generative-ui";
import { CopilotGenerativeUIIcon } from "../media";
import { defined, px } from "../style";
import type { StyleMap } from "../style";
import {
  CHECK_ERROR,
  CopilotGenerativeUIControl,
  FIELD_HOST,
  PAD_X,
  SELECT_STYLE,
  asText,
  controlStyle,
  fieldStyle,
  normalizeOptions,
  uniqueId,
} from "./control";

/** A dropdown list of options: a native select with the look of the fields. */
@Component({
  selector: "div[copilotGenerativeUISelect]",
  template: `
    @if (label(); as label) {
      <label [attr.for]="id" [style]="labelStyle">{{ label }}</label>
    }
    @if (icon(); as icon) {
      <span style="position: relative; display: flex; width: 100%">
        <span aria-hidden="true" style="display: contents">
          <svg
            copilotGenerativeUIIcon
            [name]="icon"
            [size]="16"
            [style]="iconStyle()"
          ></svg>
        </span>
        <ng-container *ngTemplateOutlet="select" />
      </span>
    } @else {
      <ng-container *ngTemplateOutlet="select" />
    }
    <ng-template #select>
      <select
        [id]="id"
        data-a2ui-input
        [attr.name]="name() ?? null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-description]="control()['aria-description'] ?? null"
        [required]="required() ?? false"
        [disabled]="disabled() ?? false"
        [attr.aria-invalid]="isInvalid() ? 'true' : null"
        [value]="valueText()"
        (change)="onChange($event)"
        [style]="selectStyle()"
      >
        @if (hasEmptyOption()) {
          <option value="">{{ clearLabel() ?? placeholder() ?? "" }}</option>
        }
        @for (option of optionList(); track option.value) {
          <option
            [value]="option.value"
            [attr.title]="option.description ?? null"
            [selected]="option.value === valueText()"
          >
            {{ option.label }}
          </option>
        }
      </select>
    </ng-template>
    ${CHECK_ERROR}
  `,
  imports: [NgTemplateOutlet, CopilotGenerativeUIIcon],
  host: FIELD_HOST,
})
export class CopilotGenerativeUISelect extends CopilotGenerativeUIControl<string> {
  readonly options = input<InputOptionList>();
  readonly placeholder = input<string>();
  readonly label = input<string>();
  readonly clearable = input<boolean>();
  readonly clearLabel = input<string>();
  readonly searchable = input<boolean>();
  readonly icon = input<string>();
  readonly block = input<boolean>();
  readonly size = input<InputSize>();
  readonly pill = input<boolean>();

  protected readonly id = uniqueId("a2ui-select");
  protected readonly valueText = computed(() => asText(this.value()));
  protected readonly normalized = computed(() =>
    normalizeOptions(this.options()),
  );
  protected readonly hasEmptyOption = computed(() =>
    Boolean(this.placeholder() || this.clearable() || this.valueText() === ""),
  );
  protected readonly ariaLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.label() ? null : (this.placeholder() ?? null)),
  );
  protected readonly hostStyle = computed(() => fieldStyle(undefined));
  // `defined`: Angular's [style] removes a key bound to undefined, and
  // removing padding-left would clear the left padding of `padding`.
  protected readonly selectStyle = computed<StyleMap>(() =>
    defined({
      ...controlStyle(
        {
          size: this.size(),
          pill: this.pill(),
          invalid: this.invalid(),
          disabled: this.disabled(),
        },
        "xl",
      ),
      ...SELECT_STYLE,
      width: this.block() === false ? undefined : "100%",
      paddingLeft: this.icon()
        ? `${PAD_X[this.size() ?? "xl"] + 24}px`
        : undefined,
    }),
  );
  protected readonly iconStyle = computed<StyleMap>(() => ({
    position: "absolute",
    left: px(PAD_X[this.size() ?? "xl"]),
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    pointerEvents: "none",
    color: textColor("secondary"),
  }));

  protected readonly optionList = this.normalized;

  protected onChange(event: Event) {
    this.setValue((event.target as HTMLSelectElement).value);
  }
}
