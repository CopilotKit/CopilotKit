import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  viewChildren,
} from "@angular/core";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  SHADOW_XS,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  InputOptionList,
  InputSize,
  checkBoxSchema,
  radioGroupSchema,
  segmentedControlSchema,
} from "@copilotkit/shared/generative-ui";
import { controlAria, wrapperAria } from "@copilotkit/core/generative-ui";
import type { z } from "zod";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import { px } from "../style";
import type { StyleMap } from "../style";
import {
  CHECK_ERROR,
  CopilotGenerativeUIControl,
  FIELD_HOST,
  FIELD_LABEL_STYLE,
  FONT_SIZE,
  HEIGHT,
  PAD_X,
  asText,
  fieldStyle,
  normalizeOptions,
  uniqueId,
} from "./control";

type RadioGroupProps = z.output<typeof radioGroupSchema>;
type RadioVariant = NonNullable<RadioGroupProps["variant"]>;
type SegmentedControlProps = z.output<typeof segmentedControlSchema>;

/**
 * A checkbox with a label. Its prop is `value` (true when checked), as the
 * A2UI catalog names it, not `checked`: the renderer binds it by that name.
 */
@Component({
  selector: "span[copilotGenerativeUICheckBox]",
  template: `
    <label [style]="labelRowStyle()">
      <input
        type="checkbox"
        class="a2ui-std-check"
        data-a2ui-input
        [attr.data-shape]="shape() ?? 'round'"
        [attr.name]="name() ?? null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-description]="control()['aria-description'] ?? null"
        [required]="required() ?? false"
        [disabled]="disabled() ?? false"
        [checked]="isChecked()"
        [attr.aria-invalid]="isInvalid() ? 'true' : null"
        (change)="onChange($event)"
      />
      @if (hasLabel()) {
        <span [style.text-decoration]="lineThrough() && isChecked() ? 'line-through' : null">{{
          label()
        }}</span>
      }
    </label>
    ${CHECK_ERROR}
  `,
  host: {
    "[attr.aria-hidden]": "wrapper()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "wrapper()['aria-live'] ?? null",
    "[style]": "hostStyle()",
  },
})
export class CopilotGenerativeUICheckBox extends CopilotGenerativeUIControl<boolean> {
  readonly label = input<string>();
  readonly weight = input<number>();
  readonly lineThrough = input<boolean>();
  readonly shape = input<z.output<typeof checkBoxSchema>["shape"]>();

  protected readonly isChecked = computed(() => Boolean(this.value()));
  protected readonly hasLabel = computed(
    () => this.label() !== undefined && this.label() !== "",
  );
  protected readonly ariaLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.hasLabel() ? null : (this.name() ?? null)),
  );
  protected readonly hostStyle = computed<StyleMap>(() => ({
    display: "inline-flex",
    flexDirection: "column",
    gap: spacing(1),
    flexGrow: this.weight(),
  }));
  protected readonly labelRowStyle = computed<StyleMap>(() => ({
    display: "inline-flex",
    alignItems: "center",
    flexGrow: this.weight(),
    gap: spacing(2),
    cursor: this.disabled() ? "not-allowed" : "pointer",
    opacity: this.disabled() ? 0.5 : undefined,
    ...textFont("md"),
    color: textColor("default"),
  }));

  protected onChange(event: Event) {
    this.setValue((event.target as HTMLInputElement).checked);
  }
}

/** One radio button. RadioGroup keeps the chosen value; this one is bare. */
@Component({
  selector: "label[copilotGenerativeUIRadio]",
  template: `
    <input
      type="radio"
      class="a2ui-std-check"
      data-a2ui-input
      [attr.value]="value() ?? null"
      [disabled]="disabled() ?? false"
      [required]="required() ?? false"
      [attr.aria-label]="control()['aria-label'] ?? null"
      [attr.aria-description]="control()['aria-description'] ?? null"
    />
    {{ label() ?? value() }}
  `,
  host: {
    "[attr.aria-hidden]": "wrapper()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "wrapper()['aria-live'] ?? null",
    "[style]": "hostStyle",
  },
})
export class CopilotGenerativeUIRadio {
  readonly value = input<string>();
  readonly label = input<string>();
  readonly disabled = input<boolean>();
  readonly required = input<boolean>();

  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly control = computed(() => controlAria(this.aria()));
  protected readonly wrapper = computed(() => wrapperAria(this.aria()));
  protected readonly hostStyle: StyleMap = {
    display: "inline-flex",
    alignItems: "center",
    gap: spacing(2),
    ...textFont("md"),
  };

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}

export function radioOptionStyle(
  variant: RadioVariant,
  isSelected: boolean,
): StyleMap {
  const base: StyleMap = {
    display: "inline-flex",
    alignItems: variant === "cards" ? "flex-start" : "center",
    gap: spacing(2),
    cursor: "pointer",
    ...textFont("md"),
  };
  if (variant === "list") return base;
  return {
    ...base,
    padding: variant === "cards" ? spacing(3) : `4px ${spacing(3)}`,
    border: `1px solid ${isSelected ? ACCENT : borderColor("default")}`,
    borderRadius: variant === "pills" ? "9999px" : radius("lg"),
  };
}

/** Native radios in a fieldset, so the arrow keys work without extra code. */
@Component({
  selector: "fieldset[copilotGenerativeUIRadioGroup]",
  template: `
    @if (label(); as label) {
      <legend [style]="legendStyle">{{ label }}</legend>
    }
    <div [style]="listStyle()">
      @for (option of optionList(); track option.value) {
        <label [style]="optionStyle(option.value)">
          <input
            type="radio"
            data-a2ui-input
            class="a2ui-std-check"
            [attr.name]="groupName()"
            [value]="option.value"
            [required]="required() ?? false"
            [checked]="option.value === valueText()"
            (change)="setValue(option.value)"
          />
          <span style="display: flex; flex-direction: column">
            <span>{{ option.label }}</span>
            @if (option.description) {
              <span [style]="smallStyle">{{ option.description }}</span>
            }
          </span>
        </label>
      }
    </div>
    ${CHECK_ERROR}
  `,
  host: {
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[disabled]": "disabled() ?? false",
    "[attr.aria-invalid]": "isInvalid() ? 'true' : null",
    style: "border: 0; margin: 0; padding: 0; min-width: 0",
  },
})
export class CopilotGenerativeUIRadioGroup extends CopilotGenerativeUIControl<string> {
  readonly options = input<InputOptionList>();
  readonly label = input<string>();
  readonly direction = input<RadioGroupProps["direction"]>();
  readonly variant = input<RadioVariant>();

  readonly #fallbackName = uniqueId("a2ui-radios");
  protected readonly groupName = computed(
    () => this.name() ?? this.#fallbackName,
  );
  protected readonly valueText = computed(() => asText(this.value()));
  protected readonly optionList = computed(() =>
    normalizeOptions(this.options()),
  );
  protected readonly legendStyle: StyleMap = {
    ...FIELD_LABEL_STYLE,
    padding: "0",
    marginBottom: spacing(1),
  };
  protected readonly listStyle = computed<StyleMap>(() => ({
    display: "flex",
    flexDirection: this.direction() === "col" ? "column" : "row",
    flexWrap: "wrap",
    gap: spacing((this.variant() ?? "list") === "list" ? 3 : 2),
  }));

  protected optionStyle(optionValue: string) {
    return radioOptionStyle(
      this.variant() ?? "list",
      optionValue === this.valueText(),
    );
  }
}

/**
 * The option that an arrow key, Home or End moves to, or `undefined` for
 * other keys. The arrow keys wrap at the ends.
 */
function nextOptionIndex(key: string, index: number, count: number) {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * A radio group drawn as buttons. It is one tab stop: the selected segment
 * (or the first one) is in the tab order, and the arrow keys, Home and End
 * move the focus and select the segment.
 */
@Component({
  selector: "div[copilotGenerativeUISegmentedControl]",
  template: `
    @if (label(); as label) {
      <span [id]="labelId" [style]="labelStyle">{{ label }}</span>
    }
    <div
      role="radiogroup"
      [attr.aria-labelledby]="label() ? labelId : null"
      [style]="groupStyle()"
    >
      @for (option of optionList(); track option.value; let index = $index) {
        <button
          #segment
          type="button"
          role="radio"
          [attr.aria-checked]="index === selectedIndex()"
          [attr.tabindex]="index === tabStopIndex() ? 0 : -1"
          data-a2ui-input
          [disabled]="disabled() ?? false"
          (click)="onSegmentClick($event, option.value)"
          (keydown)="onKeyDown($event, index)"
          [style]="segmentStyle(index)"
        >
          {{ option.label }}
        </button>
      }
    </div>
    ${CHECK_ERROR}
  `,
  host: FIELD_HOST,
})
export class CopilotGenerativeUISegmentedControl extends CopilotGenerativeUIControl<string> {
  readonly options = input<InputOptionList>();
  readonly label = input<string>();
  readonly block = input<boolean>();
  readonly size = input<InputSize>();
  readonly pill = input<boolean>();
  readonly variant = input<SegmentedControlProps["variant"]>();

  protected readonly labelId = uniqueId("a2ui-segments");
  protected readonly segments =
    viewChildren<ElementRef<HTMLButtonElement>>("segment");
  protected readonly valueText = computed(() => asText(this.value()));
  protected readonly optionList = computed(() =>
    normalizeOptions(this.options()),
  );
  protected readonly selectedIndex = computed(() =>
    this.optionList().findIndex((option) => option.value === this.valueText()),
  );
  protected readonly tabStopIndex = computed(() =>
    this.selectedIndex() === -1 ? 0 : this.selectedIndex(),
  );
  protected readonly hostStyle = computed(() => fieldStyle(undefined));
  protected readonly groupStyle = computed<StyleMap>(() => ({
    display: this.block() ? "flex" : "inline-flex",
    width: this.block() ? "100%" : undefined,
    gap: px(2),
    padding: px(2),
    boxSizing: "border-box",
    background: backgroundColor("surface-secondary"),
    border:
      this.variant() === "outline"
        ? `1px solid ${borderColor("default")}`
        : undefined,
    borderRadius: this.pill() !== false ? "9999px" : radius("md"),
    opacity: this.disabled() ? 0.5 : undefined,
  }));

  protected segmentStyle(index: number): StyleMap {
    const segmentSize = this.size() ?? "lg";
    const isSelected = index === this.selectedIndex();
    const isSolid = this.variant() === "solid";
    const isPill = this.pill() !== false;
    const selectedBackground = isSolid ? ACCENT : backgroundColor("surface");
    const selectedColor = isSolid ? ON_ACCENT : textColor("default");
    return {
      flex: this.block() ? 1 : undefined,
      minHeight: px(HEIGHT[segmentSize] - 4),
      padding: `0 ${PAD_X[segmentSize]}px`,
      fontSize: FONT_SIZE[segmentSize],
      fontFamily: "inherit",
      fontWeight: FONT_WEIGHT.medium,
      border: "none",
      cursor: this.disabled() ? "not-allowed" : "pointer",
      borderRadius: isPill ? "9999px" : radius("sm"),
      background: isSelected ? selectedBackground : "transparent",
      color: isSelected ? selectedColor : textColor("secondary"),
      boxShadow: isSelected && !isSolid ? SHADOW_XS : undefined,
    };
  }

  protected onSegmentClick(event: MouseEvent, optionValue: string) {
    event.stopPropagation();
    this.setValue(optionValue);
  }

  protected onKeyDown(event: KeyboardEvent, index: number) {
    const options = this.optionList();
    const next = nextOptionIndex(event.key, index, options.length);
    if (next === undefined) return;
    event.preventDefault();
    this.setValue(options[next]!.value);
    this.segments()[next]?.nativeElement.focus();
  }
}
