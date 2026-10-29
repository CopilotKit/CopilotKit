import { Component, computed, input } from "@angular/core";
import type {
  InputSize,
  textFieldSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { StyleMap } from "../style";
import {
  CHECK_ERROR,
  CopilotGenerativeUIControl,
  FIELD_HOST,
  PAD_X,
  asText,
  controlStyle,
  fieldStyle,
  uniqueId,
} from "./control";

type TextFieldVariant = z.output<typeof textFieldSchema>["variant"];

/** The `type` of the input of each single-line TextField variant. */
const TEXT_FIELD_TYPE: Record<string, string> = {
  shortText: "text",
  number: "number",
  obscured: "password",
  email: "email",
  url: "url",
  tel: "tel",
};

/** A text input, single-line unless `variant` is "longText". */
@Component({
  selector: "div[copilotGenerativeUITextField]",
  template: `
    @if (label(); as label) {
      <label [attr.for]="id" [style]="labelStyle">{{ label }}</label>
    }
    @if (variant() === "longText") {
      <textarea
        #area
        [id]="id"
        data-a2ui-input
        [attr.name]="name() ?? null"
        [attr.placeholder]="placeholder() ?? null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-description]="control()['aria-description'] ?? null"
        [required]="required() ?? false"
        [disabled]="disabled() ?? false"
        [readOnly]="readonly() ?? false"
        [attr.aria-invalid]="isInvalid() ? 'true' : null"
        rows="3"
        [value]="valueText()"
        (input)="onInput($event)"
        [style]="areaStyle()"
      ></textarea>
    } @else {
      <input
        #field
        [id]="id"
        data-a2ui-input
        [attr.type]="inputType()"
        [attr.name]="name() ?? null"
        [attr.placeholder]="placeholder() ?? null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-description]="control()['aria-description'] ?? null"
        [required]="required() ?? false"
        [disabled]="disabled() ?? false"
        [readOnly]="readonly() ?? false"
        [attr.aria-invalid]="isInvalid() ? 'true' : null"
        [value]="valueText()"
        (focus)="onFocus($event)"
        (input)="onInput($event)"
        [style]="inputStyle()"
      />
    }
    ${CHECK_ERROR}
  `,
  host: FIELD_HOST,
})
export class CopilotGenerativeUITextField extends CopilotGenerativeUIControl<
  string | number
> {
  readonly placeholder = input<string>();
  readonly label = input<string>();
  readonly variant = input<TextFieldVariant>();
  readonly weight = input<number>();
  readonly size = input<InputSize>();
  readonly pill = input<boolean>();
  readonly autoSelect = input<boolean>();
  readonly mask = input<string>();

  protected readonly id = uniqueId("a2ui-field");
  protected readonly valueText = computed(() => asText(this.value()));
  protected readonly inputType = computed(
    () => TEXT_FIELD_TYPE[this.variant() ?? "shortText"] ?? "text",
  );
  // Without a visible label, the placeholder still names the field. The
  // envelope's name wins: ARIA names do not inherit from the group.
  protected readonly ariaLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.label() ? null : (this.placeholder() ?? null)),
  );
  protected readonly hostStyle = computed(() => fieldStyle(this.weight()));
  protected readonly inputStyle = computed(() =>
    controlStyle(
      {
        size: this.size(),
        pill: this.pill(),
        invalid: this.invalid(),
        disabled: this.disabled(),
      },
      "xl",
    ),
  );
  protected readonly areaStyle = computed(() =>
    textAreaStyle(
      { size: this.size(), invalid: this.invalid(), disabled: this.disabled() },
      { autoResize: false, maxRows: undefined },
    ),
  );

  protected onFocus(event: FocusEvent) {
    if (this.autoSelect()) (event.target as HTMLInputElement).select();
  }

  protected onInput(event: Event) {
    this.setValue((event.target as HTMLInputElement).value);
  }
}

function textAreaStyle(
  props: { size?: InputSize; invalid?: boolean; disabled?: boolean },
  options: { autoResize: boolean | undefined; maxRows: number | undefined },
): StyleMap {
  const areaSize = props.size ?? "xl";
  return {
    ...controlStyle({ ...props, pill: false }, areaSize),
    padding: `${PAD_X[areaSize] / 2}px ${PAD_X[areaSize]}px`,
    resize: options.autoResize ? "none" : "vertical",
    maxHeight: options.maxRows
      ? `calc(${options.maxRows} * 1.5em + ${PAD_X[areaSize]}px)`
      : undefined,
    lineHeight: 1.5,
  };
}

/** A multi-line text input. */
@Component({
  selector: "div[copilotGenerativeUITextArea]",
  template: `
    @if (label(); as label) {
      <label [attr.for]="id" [style]="labelStyle">{{ label }}</label>
    }
    <textarea
      [id]="id"
      data-a2ui-input
      [attr.name]="name() ?? null"
      [attr.placeholder]="placeholder() ?? null"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-description]="control()['aria-description'] ?? null"
      [required]="required() ?? false"
      [disabled]="disabled() ?? false"
      [readOnly]="readonly() ?? false"
      [attr.aria-invalid]="isInvalid() ? 'true' : null"
      [rows]="rows() ?? 3"
      [value]="valueText()"
      (input)="onInput($event)"
      [style]="areaStyle()"
    ></textarea>
    ${CHECK_ERROR}
  `,
  host: FIELD_HOST,
})
export class CopilotGenerativeUITextArea extends CopilotGenerativeUIControl<string> {
  readonly placeholder = input<string>();
  readonly label = input<string>();
  readonly weight = input<number>();
  readonly rows = input<number>();
  readonly maxRows = input<number>();
  readonly autoResize = input<boolean>();
  readonly size = input<InputSize>();

  protected readonly id = uniqueId("a2ui-area");
  protected readonly valueText = computed(() => asText(this.value()));
  protected readonly ariaLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.label() ? null : (this.placeholder() ?? null)),
  );
  protected readonly hostStyle = computed(() => fieldStyle(this.weight()));
  protected readonly areaStyle = computed(() =>
    textAreaStyle(
      { size: this.size(), invalid: this.invalid(), disabled: this.disabled() },
      { autoResize: this.autoResize(), maxRows: this.maxRows() },
    ),
  );

  protected onInput(event: Event) {
    const element = event.target as HTMLTextAreaElement;
    this.setValue(element.value);
    if (!this.autoResize()) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }
}
